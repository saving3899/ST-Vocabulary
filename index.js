// ST-Vocabulary Extension
// Furigana display & Vocabulary builder for SillyTavern
// Uses independent API calls — does NOT block chat generation.
// ─────────────────────────────────────────────────────

import {
    eventSource,
    event_types,
    getRequestHeaders,
    saveSettingsDebounced,
} from '../../../../script.js';

import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { SECRET_KEYS, secret_state } from '../../../secrets.js';
import { oai_settings } from '../../../openai.js';

const MODULE_NAME = 'ST-Vocabulary';

// ── In-memory caches ──────────────────────────────────
const furiganaCache = new Map();

// ── Provider map ──────────────────────────────────────
const PROVIDERS = {
    openai: { label: 'OpenAI', secretKey: 'OPENAI', source: 'openai' },
    claude: { label: 'Claude', secretKey: 'CLAUDE', source: 'claude' },
    google: { label: 'Google AI Studio', secretKey: 'MAKERSUITE', source: 'makersuite' },
    openrouter: { label: 'OpenRouter', secretKey: 'OPENROUTER', source: 'openrouter' },
    deepseek: { label: 'DeepSeek', secretKey: 'DEEPSEEK', source: 'deepseek' },
    cohere: { label: 'Cohere', secretKey: 'COHERE', source: 'cohere' },
    mistralai: { label: 'MistralAI', secretKey: 'MISTRALAI', source: 'mistralai' },
    groq: { label: 'Groq', secretKey: 'GROQ', source: 'groq' },
    xai: { label: 'xAI (Grok)', secretKey: 'XAI', source: 'xai' },
    perplexity: { label: 'Perplexity', secretKey: 'PERPLEXITY', source: 'perplexity' },
    ai21: { label: 'AI21', secretKey: 'AI21', source: 'ai21' },
    fireworks: { label: 'Fireworks AI', secretKey: 'FIREWORKS', source: 'fireworks' },
    moonshot: { label: 'Moonshot', secretKey: 'MOONSHOT', source: 'moonshot' },
    siliconflow: { label: 'SiliconFlow', secretKey: 'SILICONFLOW', source: 'siliconflow' },
    vertexai: { label: 'Google Vertex AI', secretKey: 'VERTEXAI', source: 'vertexai' },
    azure_openai: { label: 'Azure OpenAI', secretKey: 'AZURE_OPENAI', source: 'azure_openai' },
    nanogpt: { label: 'NanoGPT', secretKey: 'NANOGPT', source: 'nanogpt' },
    electronhub: { label: 'ElectronHub', secretKey: 'ELECTRONHUB', source: 'electronhub' },
    chutes: { label: 'Chutes', secretKey: 'CHUTES', source: 'chutes' },
    aimlapi: { label: 'AIML API', secretKey: 'AIMLAPI', source: 'aimlapi' },
    pollinations: { label: 'Pollinations', secretKey: 'POLLINATIONS', source: 'pollinations' },
    cometapi: { label: 'Comet API', secretKey: 'COMETAPI', source: 'cometapi' },
    zai: { label: 'ZAI', secretKey: 'ZAI', source: 'zai' },
    custom: { label: 'Custom (OpenAI 호환)', secretKey: 'CUSTOM', source: 'custom' },
};

const DEFAULT_MODELS = {
    openai: 'gpt-4-turbo',
    claude: 'claude-sonnet-4-5',
    google: 'gemini-2.5-pro',
    openrouter: 'OR_Website',
    deepseek: 'deepseek-chat',
    cohere: 'command-r-plus',
    mistralai: 'mistral-large-latest',
    groq: 'llama-3.3-70b-versatile',
    xai: 'grok-3-beta',
    perplexity: 'sonar-pro',
    ai21: 'jamba-large',
    fireworks: 'accounts/fireworks/models/kimi-k2-instruct',
    moonshot: 'kimi-latest',
    siliconflow: 'deepseek-ai/DeepSeek-V3',
    vertexai: 'gemini-2.5-pro',
    azure_openai: '',
    nanogpt: 'gpt-4o-mini',
    electronhub: 'gpt-4o-mini',
    chutes: 'deepseek-ai/DeepSeek-V3-0324',
    aimlapi: 'chatgpt-4o-latest',
    pollinations: 'openai',
    cometapi: 'gpt-4o',
    zai: 'glm-4.6',
    custom: '',
};

// ── Default Settings ──────────────────────────────────
const defaultSettings = Object.freeze({
    enabled: true,
    furiganaEnabled: true,
    autoFurigana: 'off',       // 'off' | 'ai' | 'user' | 'both'
    showOnUserMsg: false,
    showOnBotMsg: true,
    furiganaSize: 0.55,
    furiganaColor: '#888888',
    furiganaOpacity: 0.9,
    highlightVocab: false,
    highlightWordForms: false,
    vocabHighlightColor: '#6495ED',
    vocabHoverColor: '#6495ED',
    furiganaHover: false,
    showKatakanaFurigana: false,
    furiganaEditOnClick: true,
    theme: 'auto',
    // API
    provider: 'openai',
    model: 'gpt-4o-mini',
    // temperature and maxTokens are hardcoded internally (not user-configurable)
    // Vocabulary
    vocabList: [],
    // Legacy furiganaData — migrated to chatMetadata on chat load
    // furiganaData is intentionally omitted from defaults.
});

// Map of mesId → AbortController for in-progress furigana generation
var furiganaAbortControllers = new Map();

/**
 * Show a progress snackbar at the bottom during furigana generation.
 * Includes a spinning icon, message text, and a stop button.
 * @param {string} mesId - The message ID being processed
 * @param {string} [label] - Optional label override
 * @returns {HTMLElement} The snackbar element
 */
function showFuriganaProgressSnackbar(mesId, label) {
    // Remove any existing progress snackbar
    hideFuriganaProgressSnackbar();

    var snackbar = document.createElement('div');
    snackbar.id = 'stv-furigana-progress';
    snackbar.className = 'stv-snackbar stv-furigana-progress';
    snackbar.setAttribute('popover', 'manual');
    snackbar.innerHTML = '<span class="stv-snackbar-text">'
        + '<span class="fa-solid fa-language stv-furigana-progress-spin"></span> '
        + (label || '후리가나 생성 중...')
        + '</span>'
        + '<div class="stv-snackbar-actions">'
        + '<button class="stv-snackbar-btn stv-snackbar-stop"><span class="fa-solid fa-stop"></span> 중지</button>'
        + '</div>';
    document.body.appendChild(snackbar);
    snackbar.showPopover();
    // Double rAF ensures the initial hidden state is painted before showing
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            snackbar.classList.add('stv-snackbar-show');
        });
    });

    snackbar.querySelector('.stv-snackbar-stop').addEventListener('click', function () {
        var ctrl = furiganaAbortControllers.get(String(mesId));
        if (ctrl) {
            ctrl.abort();
            furiganaAbortControllers.delete(String(mesId));
        }
        hideFuriganaProgressSnackbar();
    });

    return snackbar;
}

/** Remove the furigana progress snackbar. */
function hideFuriganaProgressSnackbar() {
    var el = document.getElementById('stv-furigana-progress');
    if (el) {
        el.classList.remove('stv-snackbar-show');
        el.classList.add('stv-snackbar-hide');
        setTimeout(function () {
            try { el.hidePopover(); } catch (e) { }
            el.remove();
        }, 300);
    }
}

// ── Settings Management ───────────────────────────────
function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = extension_settings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = defaultSettings[key];
    }
    return s;
}

function saveSettings() {
    saveSettingsDebounced();
}

// ── Utility Functions ─────────────────────────────────
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
}

/** Convert katakana characters in a string to hiragana. */
function katakanaToHiragana(str) {
    if (!str) return str;
    return str.replace(/[\u30A1-\u30F6]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
}

/** Normalize reading to hiragana if the word language is Japanese. */
function normalizeReading(reading, language) {
    if (language === 'ja' && reading) return katakanaToHiragana(reading);
    return reading;
}

function detectLanguage(word, reading) {
    if (!word) return 'unknown';
    // Check for Japanese kana first (hiragana/katakana) — if present, it's Japanese
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(word)) return 'ja';
    // Pure CJK ideographs: check reading for kana to distinguish Japanese from Chinese
    if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(word)) {
        // If reading is provided and contains hiragana/katakana, it's Japanese
        if (reading && /[\u3040-\u309F\u30A0-\u30FF]/.test(reading)) return 'ja';
        // If reading is provided and contains NO kana (e.g. pinyin), it's Chinese
        if (reading && !/[\u3040-\u309F\u30A0-\u30FF]/.test(reading)) return 'zh';
        // No reading provided — default to Japanese (this tool is primarily for Japanese learning;
        // CJK kanji in chat context are almost always Japanese)
        return 'ja';
    }
    if (/[\uAC00-\uD7AF]/.test(word)) return 'ko';
    if (/[a-zA-Z]/.test(word)) return 'en';
    return 'other';
}

/** Check if a word uses a script that needs word-boundary matching (Latin, Cyrillic, Korean jamo, etc.) */
function needsWordBoundary(word) {
    return /^[a-zA-Z\u00C0-\u024F\u0400-\u04FF'\-]+$/.test(word);
}

function getLangLabel(lang) {
    const labels = { ja: '日本語', ko: '한국어', zh: '中文', en: 'English', other: '기타', unknown: '?' };
    return labels[lang] || labels.unknown;
}

/** Get a unique key for the current chat (character+file or group). */
function getCurrentChatId() {
    try {
        var ctx = getContext();
        if (ctx.groupId) return 'g_' + ctx.groupId;
        if (ctx.characterId >= 0 && ctx.characters && ctx.characters[ctx.characterId]) {
            return 'c_' + ctx.characterId + '_' + (ctx.characters[ctx.characterId].chat || '');
        }
    } catch (e) { /* ignore */ }
    return null;
}

/** Get text content from an element, excluding ruby annotation (rt/rp). */
function getCleanText(element) {
    var clone = element.cloneNode(true);
    clone.querySelectorAll('rt, rp').forEach(function (el) { el.remove(); });
    return clone.textContent || '';
}

/** Get clean selected text from a Selection, stripping ruby annotations. */
function getCleanSelectedText(selection) {
    if (!selection || selection.rangeCount === 0) return selection ? selection.toString().trim() : '';
    var range = selection.getRangeAt(0);
    var fragment = range.cloneContents();
    fragment.querySelectorAll('rt, rp').forEach(function (el) { el.remove(); });
    return (fragment.textContent || '').trim();
}

// ══════════════════════════════════════════════════════
//  INDEPENDENT API MODULE — does NOT lock chat send
// ══════════════════════════════════════════════════════

/**
 * Call the LLM via SillyTavern backend proxy.
 * Uses direct fetch() to /api/backends/chat-completions/generate,
 * completely bypassing the generation pipeline so chat send is never blocked.
 */
async function callLLM(prompt, signal) {
    const settings = getSettings();
    const provider = settings.provider;
    const info = PROVIDERS[provider];
    if (!info) throw new Error('지원되지 않는 프로바이더: ' + provider);

    const apiKey = provider === 'vertexai'
        ? (secret_state[SECRET_KEYS.VERTEXAI] || secret_state[SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT])
        : secret_state[SECRET_KEYS[info.secretKey]];
    if (!apiKey) throw new Error(info.label + ' API 키가 설정되어 있지 않습니다. SillyTavern API 연결 설정을 확인하세요.');

    const model = settings.model || DEFAULT_MODELS[provider] || '';
    const messages = [{ role: 'user', content: prompt }];

    const parameters = {
        model: model,
        messages: messages,
        temperature: 0.3,
        stream: false,
        chat_completion_source: info.source,
    };

    // Vertex AI 전용 파라미터 추가
    if (provider === 'vertexai') {
        parameters.vertexai_auth_mode = oai_settings.vertexai_auth_mode || 'express';
        parameters.vertexai_region = oai_settings.vertexai_region || 'global';
        if (parameters.vertexai_auth_mode === 'express' && oai_settings.vertexai_express_project_id) {
            parameters.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
        }
    }

    var fetchOptions = {
        method: 'POST',
        headers: Object.assign({}, getRequestHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(parameters),
    };
    if (signal) fetchOptions.signal = signal;

    const response = await fetch('/api/backends/chat-completions/generate', fetchOptions);

    if (!response.ok) {
        let msg = 'HTTP ' + response.status;
        try {
            const err = await response.json();
            msg = (err && err.error && err.error.message) || (err && err.message) || msg;
        } catch (_e) { /* ignore */ }
        throw new Error(msg);
    }

    const data = await response.json();
    if (typeof data === 'string') return data;
    if (data && data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
    if (data && data.content) return data.content;
    return String(data);
}

// ══════════════════════════════════════════════════════
//  FURIGANA MODULE
// ══════════════════════════════════════════════════════

const KANJI_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const KATAKANA_RE = /[\u30A1-\u30F6\u30F7-\u30FA]/;
const SKIP_TAGS = new Set(['CODE', 'PRE', 'A', 'RUBY', 'RT', 'RP', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);

function hasKanji(text) {
    return KANJI_RE.test(text);
}

function hasKatakana(text) {
    return KATAKANA_RE.test(text);
}

function textHash(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h.toString(36);
}

/**
 * Call LLM to generate furigana readings for Japanese text
 */
async function getLLMFurigana(text, signal) {
    var s = getSettings();
    var includeKatakana = s.showKatakanaFurigana;
    const key = textHash(text) + (includeKatakana ? '_k' : '');
    if (furiganaCache.has(key)) return furiganaCache.get(key);

    var katakanaRule = includeKatakana
        ? '- Also include katakana words with their hiragana reading (e.g. {"word":"コンピュータ","reading":"こんぴゅーた"}, {"word":"テレビ","reading":"てれび"})\n'
        : '- Do NOT include pure hiragana or katakana words\n';

    const prompt = 'You are a Japanese language analysis tool. Analyze the following text and provide furigana (hiragana readings) for ALL words containing kanji'
        + (includeKatakana ? ' and all katakana words' : '') + '.\n\n'
        + 'Return ONLY a valid JSON array. Each element must have:\n'
        + '- "word": the original text segment (include attached okurigana, e.g. 食べる not 食)\n'
        + '- "reading": the full hiragana reading (e.g. たべる)\n\n'
        + 'Rules:\n'
        + '- Include okurigana in both word and reading\n'
        + katakanaRule
        + '- Do NOT include pure hiragana words\n'
        + '- If the same word appears with the same reading, include it ONCE only\n'
        + '- Return ONLY the JSON array, no explanation\n\n'
        + 'Text: ' + text + '\n\nJSON:';

    try {
        const resp = await callLLM(prompt, signal);
        const match = resp.match(/\[[\s\S]*?\]/);
        if (!match) return [];
        const readings = JSON.parse(match[0]);
        const valid = readings.filter(function (r) { return r && typeof r.word === 'string' && typeof r.reading === 'string'; });
        furiganaCache.set(key, valid);
        return valid;
    } catch (e) {
        console.error('[' + MODULE_NAME + '] Furigana generation error:', e);
        throw e;
    }
}

/**
 * Apply furigana ruby tags to a DOM element.
 * Uses placeholder-based replacement to prevent nested ruby tags.
 */
function applyFuriganaToElement(element, readings, force) {
    if (!readings || readings.length === 0) return;
    // Skip if element already has furigana (unless force=true for partial add)
    if (!force && element.querySelector && element.querySelector('.stv-ruby')) return;

    var includeKatakana = getSettings().showKatakanaFurigana;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            let parent = node.parentNode;
            while (parent && parent !== element) {
                if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                parent = parent.parentNode;
            }
            var txt = node.textContent;
            if (hasKanji(txt)) return NodeFilter.FILTER_ACCEPT;
            if (includeKatakana && hasKatakana(txt)) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_REJECT;
        },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // Deduplicate readings by word (keep first occurrence)
    var seen = new Set();
    var unique = [];
    for (var ui = 0; ui < readings.length; ui++) {
        var r = readings[ui];
        if (!r || !r.word || !r.reading) continue;
        if (seen.has(r.word)) continue;
        seen.add(r.word);
        unique.push(r);
    }

    // Sort by word length descending (longer words first)
    unique.sort(function (a, b) { return b.word.length - a.word.length; });

    // Build placeholder map
    var placeholders = [];
    for (var pi = 0; pi < unique.length; pi++) {
        placeholders.push({
            word: unique[pi].word,
            reading: unique[pi].reading,
            token: '\x00STVRB' + pi + '\x00',
        });
    }

    for (var ti = 0; ti < textNodes.length; ti++) {
        var textNode = textNodes[ti];
        var html = escapeHtml(textNode.textContent);
        var changed = false;

        // Phase 1: Replace kanji words with placeholders (longest first)
        for (var ri = 0; ri < placeholders.length; ri++) {
            var ph = placeholders[ri];
            var escapedWord = escapeHtml(ph.word);
            var pattern = new RegExp(escapeRegex(escapedWord), 'g');
            var newHtml = html.replace(pattern, ph.token);
            if (newHtml !== html) {
                html = newHtml;
                changed = true;
            }
        }

        // Phase 2: Replace placeholders with actual ruby HTML
        if (changed) {
            var settings2 = getSettings();
            var vocabWords = new Set();
            var formsMapLocal = null;
            if (settings2.highlightVocab) {
                settings2.vocabList.forEach(function (w) { vocabWords.add(w.word); });
                if (settings2.highlightWordForms) {
                    formsMapLocal = buildWordFormsMap();
                }
            }
            for (var ri2 = 0; ri2 < placeholders.length; ri2++) {
                var ph2 = placeholders[ri2];
                var isVocab = vocabWords.has(ph2.word);
                var isForm = !isVocab && formsMapLocal && formsMapLocal[ph2.word];
                var cls = 'stv-ruby' + ((isVocab || isForm) ? ' stv-vocab-highlight' : '') + (isForm ? ' stv-vocab-form' : '');
                var dataAttr = ' data-stv-word="' + escapeHtml(ph2.word) + '"';
                if (isForm) {
                    dataAttr += ' data-stv-base-id="' + escapeHtml(formsMapLocal[ph2.word].baseWordId) + '"';
                }
                var ruby = '<ruby class="' + cls + '"' + dataAttr + '>' + escapeHtml(ph2.word)
                    + '<rp>(</rp><rt>' + escapeHtml(ph2.reading) + '</rt><rp>)</rp></ruby>';
                html = html.split(ph2.token).join(ruby);
            }
            var wrapper = document.createElement('span');
            wrapper.className = 'stv-furigana-wrapper';
            wrapper.innerHTML = html;
            textNode.parentNode.replaceChild(wrapper, textNode);
        }
    }
}

/**
 * Highlight vocabulary words in plain text nodes (non-kanji words like katakana, romaji, etc.)
 * This runs AFTER furigana is applied, only targeting text nodes not already inside ruby/highlight elements.
 */
function highlightVocabInElement(element) {
    if (!element) return;
    var settings = getSettings();
    if (!settings.highlightVocab || !settings.vocabList || settings.vocabList.length === 0) return;

    // Build sorted word list (longest first to avoid partial matches)
    var savedWordsSet = new Set(settings.vocabList.map(function (w) { return w.word; }));
    var vocabWords = settings.vocabList.map(function (w) { return w.word; })
        .filter(function (w) { return w && w.length > 0; });

    // Build forms map for highlighting conjugated forms
    var formsMap = null;
    if (settings.highlightWordForms) {
        formsMap = buildWordFormsMap();
        // Add form words to the highlight list (if not already a saved word)
        Object.keys(formsMap).forEach(function (formWord) {
            if (!savedWordsSet.has(formWord)) {
                vocabWords.push(formWord);
            }
        });
    }

    vocabWords = vocabWords.filter(function (w) { return w && w.length > 0; })
        .sort(function (a, b) { return b.length - a.length; });
    if (vocabWords.length === 0) return;

    // Collect text nodes NOT inside ruby/highlight elements
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            var parent = node.parentNode;
            while (parent && parent !== element) {
                if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                if (parent.classList && (parent.classList.contains('stv-ruby') || parent.classList.contains('stv-vocab-highlight') || parent.classList.contains('stv-vocab-hl-span'))) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.tagName === 'RUBY' || parent.tagName === 'RT' || parent.tagName === 'RP') return NodeFilter.FILTER_REJECT;
                parent = parent.parentNode;
            }
            var text = node.textContent;
            if (!text || text.trim().length === 0) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // Use placeholder approach to avoid HTML tag injection conflicts
    var PLACEHOLDER_PREFIX = '\x00STVHL';
    var PLACEHOLDER_SUFFIX = '\x00';

    for (var i = 0; i < textNodes.length; i++) {
        var textNode = textNodes[i];
        var text = textNode.textContent;
        var placeholders = [];
        var changed = false;

        // Phase 1: Replace matches with placeholders (on plain text, no HTML yet)
        for (var wi = 0; wi < vocabWords.length; wi++) {
            var vw = vocabWords[wi];
            var escaped = escapeRegex(vw);
            // Add word boundaries for Latin-script words to avoid partial matches
            var patternStr = needsWordBoundary(vw) ? '\\b' + escaped + '\\b' : escaped;
            // Case-insensitive for Latin-script words
            var flags = needsWordBoundary(vw) ? 'gi' : 'g';
            var pattern = new RegExp(patternStr, flags);
            text = text.replace(pattern, function (match) {
                changed = true;
                var idx = placeholders.length;
                placeholders.push({ word: vw, matched: match });
                return PLACEHOLDER_PREFIX + idx + PLACEHOLDER_SUFFIX;
            });
        }

        if (!changed) continue;

        // Phase 2: Escape HTML on the placeholder-replaced text
        var html = escapeHtml(text);

        // Phase 3: Replace placeholders with actual highlight spans
        for (var pi = 0; pi < placeholders.length; pi++) {
            var ph = placeholders[pi];
            var phToken = escapeHtml(PLACEHOLDER_PREFIX + pi + PLACEHOLDER_SUFFIX);
            var isFormWord = formsMap && formsMap[ph.word] && !savedWordsSet.has(ph.word);
            var extraCls = isFormWord ? ' stv-vocab-form' : '';
            var extraAttr = isFormWord ? ' data-stv-base-id="' + escapeHtml(formsMap[ph.word].baseWordId) + '"' : '';
            html = html.replace(phToken, '<span class="stv-vocab-hl-span stv-vocab-highlight' + extraCls + '" data-stv-word="' + escapeHtml(ph.word) + '"' + extraAttr + '>' + escapeHtml(ph.matched) + '</span>');
        }

        var wrapper = document.createElement('span');
        wrapper.className = 'stv-furigana-wrapper';
        wrapper.innerHTML = html;
        textNode.parentNode.replaceChild(wrapper, textNode);
    }

    // Second pass: highlight vocab words spanning multiple nodes (ruby + text)
    highlightVocabAcrossNodes(element, vocabWords, formsMap, savedWordsSet);
}

/**
 * Highlight vocab words that span multiple DOM nodes after furigana application.
 * E.g., '沸き上がる' split into ruby(沸) + text(き) + ruby(上) + text(がる).
 */
function highlightVocabAcrossNodes(element, vocabWords, formsMap, savedWordsSet) {
    if (!element.querySelector('.stv-ruby')) return;
    var vocabMulti = vocabWords.filter(function (w) { return w.length > 1; });
    if (vocabMulti.length === 0) return;

    var maxPasses = 10;
    for (var pass = 0; pass < maxPasses; pass++) {
        var wrappers = element.querySelectorAll('.stv-furigana-wrapper');
        var didModify = false;
        for (var wi = 0; wi < wrappers.length; wi++) {
            if (_matchVocabInWrapper(wrappers[wi], vocabMulti, formsMap, savedWordsSet)) {
                didModify = true;
                break;
            }
        }
        if (!didModify) break;
    }
}

function _matchVocabInWrapper(wrapper, vocabWords, formsMap, savedWordsSet) {
    if (wrapper.closest('.stv-vocab-hl-span')) return false;
    var segments = [];
    var pos = 0;
    var children = wrapper.childNodes;
    for (var ci = 0; ci < children.length; ci++) {
        var child = children[ci];
        if (child.nodeType === Node.TEXT_NODE) {
            var t = child.textContent;
            if (t.length > 0) {
                segments.push({ node: child, text: t, start: pos, end: pos + t.length, type: 'text' });
                pos += t.length;
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.classList && child.classList.contains('stv-ruby')) {
                var baseText = '';
                for (var j = 0; j < child.childNodes.length; j++) {
                    if (child.childNodes[j].nodeType === Node.TEXT_NODE) { baseText = child.childNodes[j].textContent; break; }
                }
                var isHl = child.classList.contains('stv-vocab-highlight');
                segments.push({ node: child, text: baseText, start: pos, end: pos + baseText.length, type: isHl ? 'hl' : 'ruby' });
                pos += baseText.length;
            } else if (child.classList && child.classList.contains('stv-vocab-hl-span')) {
                var hlText = getCleanText(child);
                segments.push({ node: child, text: hlText, start: pos, end: pos + hlText.length, type: 'hl' });
                pos += hlText.length;
            } else {
                var ot = child.textContent || '';
                segments.push({ node: child, text: ot, start: pos, end: pos + ot.length, type: 'other' });
                pos += ot.length;
            }
        }
    }
    if (segments.length < 2) return false;
    var fullText = segments.map(function (s) { return s.text; }).join('');

    for (var vi = 0; vi < vocabWords.length; vi++) {
        var vw = vocabWords[vi];
        var idx = fullText.indexOf(vw);
        if (idx === -1) continue;
        var matchStart = idx;
        var matchEnd = idx + vw.length;
        var matchedIdxs = [];
        for (var si = 0; si < segments.length; si++) {
            if (segments[si].end > matchStart && segments[si].start < matchEnd) {
                matchedIdxs.push(si);
            }
        }
        if (matchedIdxs.length < 2) continue;
        if (matchedIdxs.some(function (i) { return segments[i].type === 'hl'; })) continue;

        var firstSeg = segments[matchedIdxs[0]];
        var lastSeg = segments[matchedIdxs[matchedIdxs.length - 1]];
        if (firstSeg.start < matchStart && firstSeg.type === 'text') {
            var newNode = firstSeg.node.splitText(matchStart - firstSeg.start);
            segments[matchedIdxs[0]] = { node: newNode, text: firstSeg.text.slice(matchStart - firstSeg.start), start: matchStart, end: firstSeg.end, type: 'text' };
            firstSeg = segments[matchedIdxs[0]];
        }
        if (lastSeg.end > matchEnd && lastSeg.type === 'text') {
            lastSeg.node.splitText(matchEnd - lastSeg.start);
            segments[matchedIdxs[matchedIdxs.length - 1]] = { node: lastSeg.node, text: lastSeg.text.slice(0, matchEnd - lastSeg.start), start: lastSeg.start, end: matchEnd, type: 'text' };
            lastSeg = segments[matchedIdxs[matchedIdxs.length - 1]];
        }
        if (firstSeg.start !== matchStart || lastSeg.end !== matchEnd) continue;

        var hlSpan = document.createElement('span');
        var isFormAcross = formsMap && formsMap[vw] && savedWordsSet && !savedWordsSet.has(vw);
        hlSpan.className = 'stv-vocab-hl-span stv-vocab-highlight' + (isFormAcross ? ' stv-vocab-form' : '');
        hlSpan.setAttribute('data-stv-word', vw);
        if (isFormAcross) {
            hlSpan.setAttribute('data-stv-base-id', formsMap[vw].baseWordId);
        }
        wrapper.insertBefore(hlSpan, firstSeg.node);
        for (var mi = 0; mi < matchedIdxs.length; mi++) {
            hlSpan.appendChild(segments[matchedIdxs[mi]].node);
        }
        return true;
    }
    return false;
}

/**
 * Process furigana for a single message (triggered by button click)
 */
async function processMsgFurigana(mesId) {
    var settings = getSettings();
    if (!settings.enabled || !settings.furiganaEnabled) return;

    var messageEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
    if (!messageEl) return;

    var isUser = messageEl.getAttribute('is_user') === 'true';
    if (isUser && !settings.showOnUserMsg) return;
    if (!isUser && !settings.showOnBotMsg) return;

    var mesText = messageEl.querySelector('.mes_text');
    if (!mesText) return;

    var text = mesText.textContent;
    var hasJapanese = hasKanji(text) || (settings.showKatakanaFurigana && hasKatakana(text));
    if (!hasJapanese) {
        // No kanji (and no katakana if setting on) — still highlight vocab words
        highlightVocabInElement(mesText);
        toastr.info('이 메시지에 후리가나 대상 텍스트가 없습니다.');
        return;
    }

    // If already has furigana visible, toggle off
    if (messageEl.dataset.stvFurigana === 'done') {
        var mesTextCheck = messageEl.querySelector('.mes_text');
        if (mesTextCheck && mesTextCheck.querySelector('.stv-ruby')) {
            // Furigana is visible — remove it
            removeFuriganaFromMessage(messageEl);
            toastr.info('후리가나가 제거되었습니다.');
            return;
        }
        // Furigana flag is set but ruby elements are gone (e.g. LLM translation replaced DOM)
        // Try to reapply from stored readings
        var cachedReadings = null;
        try { cachedReadings = JSON.parse(messageEl.dataset.stvFuriganaReadings || 'null'); } catch (_) { }
        if (cachedReadings && Array.isArray(cachedReadings) && cachedReadings.length > 0) {
            if (mesTextCheck) {
                mesTextCheck.dataset.stvOriginalHtml = mesTextCheck.innerHTML;
                applyFuriganaToElement(mesTextCheck, cachedReadings);
                highlightVocabInElement(mesTextCheck);
            }
            toastr.success('후리가나 재적용 완료');
            return;
        }
        // No cached readings — fall through to regenerate
        delete messageEl.dataset.stvFurigana;
        delete messageEl.dataset.stvFuriganaReadings;
    }

    // Check if we have stored furigana data that can be reused
    {
        var storedChatData = getFuriganaStore();
        var storedEntry = storedChatData && storedChatData[String(mesId)];
        if (storedEntry) {
            var storedReadings = getStoredReadings(storedEntry);
            if (storedReadings && Array.isArray(storedReadings) && storedReadings.length > 0) {
                var mesTextStored = messageEl.querySelector('.mes_text');
                if (mesTextStored && !mesTextStored.querySelector('.stv-ruby')) {
                    // Clear hidden flag if it was set
                    if (storedEntry.hidden) {
                        delete storedEntry.hidden;
                        saveMetadataDebounced();
                    }
                    mesTextStored.dataset.stvOriginalHtml = mesTextStored.innerHTML;
                    applyFuriganaToElement(mesTextStored, storedReadings);
                    highlightVocabInElement(mesTextStored);
                    messageEl.dataset.stvFurigana = 'done';
                    messageEl.dataset.stvFuriganaReadings = JSON.stringify(storedReadings);
                    var btnStored = messageEl.querySelector('.stv-furigana-btn');
                    if (btnStored) btnStored.title = '후리가나 제거';
                    toastr.success('후리가나 재적용 완료');
                    return;
                }
            }
        }
    }

    // If already processing, abort and cancel
    if (messageEl.dataset.stvFuriganaProcessing === 'true') {
        var existingCtrl = furiganaAbortControllers.get(String(mesId));
        if (existingCtrl) {
            existingCtrl.abort();
            furiganaAbortControllers.delete(String(mesId));
        }
        return;
    }
    messageEl.dataset.stvFuriganaProcessing = 'true';

    // Create AbortController for this generation
    var abortCtrl = new AbortController();
    furiganaAbortControllers.set(String(mesId), abortCtrl);

    // Store original HTML
    mesText.dataset.stvOriginalHtml = mesText.innerHTML;

    // Show loading state on the button + progress snackbar
    var btn = messageEl.querySelector('.stv-furigana-btn');
    if (btn) {
        btn.classList.add('stv-spinning');
    }
    showFuriganaProgressSnackbar(String(mesId));

    try {
        var readings = await getLLMFurigana(text, abortCtrl.signal);
        var currentMesText = messageEl.querySelector('.mes_text');
        if (currentMesText) {
            applyFuriganaToElement(currentMesText, readings);
            highlightVocabInElement(currentMesText);
            messageEl.dataset.stvFurigana = 'done';
            messageEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
            // Persist to settings so furigana survives chat reload
            saveFuriganaForMessage(mesId, readings, text);
        }
        if (btn) btn.title = '후리가나 제거';
        toastr.success('후리가나 적용 완료');
    } catch (e) {
        if (e.name === 'AbortError') {
            toastr.info('후리가나 생성이 중지되었습니다.');
        } else {
            toastr.error('후리가나 생성 실패: ' + e.message);
        }
        // Restore original HTML on failure/abort
        var origMesText = messageEl.querySelector('.mes_text');
        if (origMesText && origMesText.dataset.stvOriginalHtml) {
            origMesText.innerHTML = origMesText.dataset.stvOriginalHtml;
            delete origMesText.dataset.stvOriginalHtml;
        }
        if (btn) btn.title = '후리가나 생성';
    } finally {
        delete messageEl.dataset.stvFuriganaProcessing;
        furiganaAbortControllers.delete(String(mesId));
        if (btn) btn.classList.remove('stv-spinning');
        hideFuriganaProgressSnackbar();
    }
}

/**
 * Remove furigana from a single message
 */
function removeFuriganaFromMessage(messageEl) {
    var mesText = messageEl.querySelector('.mes_text');
    if (mesText && mesText.dataset.stvOriginalHtml) {
        mesText.innerHTML = mesText.dataset.stvOriginalHtml;
        delete mesText.dataset.stvOriginalHtml;
        // Re-apply vocab highlights on restored original HTML
        highlightVocabInElement(mesText);
    }
    var mesId = messageEl.getAttribute('mesid');
    if (mesId) removeFuriganaForMessage(mesId);
    delete messageEl.dataset.stvFurigana;
    delete messageEl.dataset.stvFuriganaReadings;
    delete messageEl.dataset.stvFuriganaProcessing;
    var btn = messageEl.querySelector('.stv-furigana-btn');
    if (btn) btn.title = '후리가나 생성';
}

/**
 * Remove all furigana from all messages
 */
function removeAllFurigana() {
    document.querySelectorAll('#chat .mes').forEach(function (msg) { removeFuriganaFromMessage(msg); });
    // Also clear persistent data for current chat
    try {
        var ctx = getContext();
        if (ctx && ctx.chatMetadata && ctx.chatMetadata[STV_FURIGANA_KEY]) {
            delete ctx.chatMetadata[STV_FURIGANA_KEY];
            saveMetadataDebounced();
        }
    } catch (_) { /* ignore if no active chat */ }
}

// ── chatMetadata-based furigana persistence ───────────

const STV_FURIGANA_KEY = 'stvFurigana';

/**
 * Get the furigana store object from current chat's metadata.
 * Returns the { mesId: {readings, textHash, hidden?} } object, or null.
 */
function getFuriganaStore() {
    try {
        var ctx = getContext();
        if (!ctx || !ctx.chatMetadata) return null;
        return ctx.chatMetadata[STV_FURIGANA_KEY] || null;
    } catch (e) { return null; }
}

/**
 * Ensure the furigana store exists in chatMetadata, creating if needed.
 * Returns the store object.
 */
function ensureFuriganaStore() {
    var ctx = getContext();
    if (!ctx) return null;
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    if (!ctx.chatMetadata[STV_FURIGANA_KEY]) ctx.chatMetadata[STV_FURIGANA_KEY] = {};
    return ctx.chatMetadata[STV_FURIGANA_KEY];
}

/** Persist furigana readings for a message to chatMetadata. */
function saveFuriganaForMessage(mesId, readings, originalText) {
    var store = ensureFuriganaStore();
    if (!store) return;
    store[String(mesId)] = {
        readings: readings,
        textHash: originalText ? textHash(originalText) : '',
    };
    saveMetadataDebounced();
}

/** Remove persisted furigana for a message. */
function removeFuriganaForMessage(mesId) {
    var store = getFuriganaStore();
    if (!store) return;
    delete store[String(mesId)];
    saveMetadataDebounced();
}

/** Helper: get readings array from stored furigana entry (handles old format). */
function getStoredReadings(entry) {
    if (!entry) return null;
    // New format: { readings: [...], textHash: '...' }
    if (entry.readings && Array.isArray(entry.readings)) return entry.readings;
    // Old format: direct array
    if (Array.isArray(entry)) return entry;
    return null;
}

/** Helper: get stored text hash from furigana entry. */
function getStoredTextHash(entry) {
    if (!entry) return '';
    if (entry.textHash) return entry.textHash;
    return '';
}

/** Re-apply stored furigana to all messages in current chat. */
function reapplyAllStoredFurigana() {
    var chatData = getFuriganaStore();
    if (!chatData) return;

    Object.keys(chatData).forEach(function (mesId) {
        var mesEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
        if (!mesEl) return;
        if (mesEl.dataset.stvFurigana === 'done') return;

        var entry = chatData[mesId];

        // If furigana was hidden, restore 'off' state without applying
        if (entry.hidden) {
            var storedReadings = getStoredReadings(entry);
            if (storedReadings) mesEl.dataset.stvFuriganaReadings = JSON.stringify(storedReadings);
            mesEl.dataset.stvFurigana = 'off';
            var btnOff = mesEl.querySelector('.stv-furigana-btn');
            if (btnOff) btnOff.title = '후리가나';
            return;
        }

        var mesText = mesEl.querySelector('.mes_text');
        if (!mesText) return;
        if (mesText.querySelector('.stv-ruby')) return;

        var readings = getStoredReadings(entry);
        if (!readings || !Array.isArray(readings)) return;

        // Check if text has changed since furigana was stored
        var storedHash = getStoredTextHash(entry);
        if (storedHash) {
            var currentText = mesText.textContent || '';
            if (textHash(currentText) !== storedHash) {
                // Text differs from when furigana was stored.
                // This may be because a translator replaced the text with display_text,
                // or the message was genuinely edited.
                // Try to apply anyway — applyFuriganaToElement only replaces kanji still present.
                // Do NOT delete stored data, so furigana survives when original text is restored.
                mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                applyFuriganaToElement(mesText, readings);
                highlightVocabInElement(mesText);
                mesEl.dataset.stvFurigana = 'done';
                mesEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
                var btnMismatch = mesEl.querySelector('.stv-furigana-btn');
                if (btnMismatch) btnMismatch.title = '후리가나 제거';
                return;
            }
        }

        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
        applyFuriganaToElement(mesText, readings);
        highlightVocabInElement(mesText);
        mesEl.dataset.stvFurigana = 'done';
        mesEl.dataset.stvFuriganaReadings = JSON.stringify(readings);

        var btn = mesEl.querySelector('.stv-furigana-btn');
        if (btn) btn.title = '후리가나 제거';
    });
}

/**
 * Toggle furigana visibility via CSS class
 */
function updateFuriganaVisibility() {
    var settings = getSettings();
    var chat = document.getElementById('chat');
    if (chat) {
        chat.classList.toggle('stv-show-furigana', settings.furiganaEnabled);
        chat.classList.toggle('stv-furigana-hover', settings.furiganaHover);
    }
    applyFuriganaSize();
}

/** Apply furigana font-size CSS variable */
function applyFuriganaSize() {
    var settings = getSettings();
    var size = settings.furiganaSize != null ? settings.furiganaSize : 0.55;
    document.documentElement.style.setProperty('--stv-furigana-size', size + 'em');
}

/** Apply furigana color as CSS variable */
function applyFuriganaColor() {
    var settings = getSettings();
    var color = settings.furiganaColor || '#888888';
    var opacity = settings.furiganaOpacity != null ? settings.furiganaOpacity : 0.9;
    document.documentElement.style.setProperty('--stv-furigana-color', color);
    document.documentElement.style.setProperty('--stv-furigana-opacity', opacity);
}

/** Apply vocab highlight colors as CSS variables */
function applyVocabColors() {
    var settings = getSettings();
    var color = settings.vocabHighlightColor || '#6495ED';
    var hoverColor = settings.vocabHoverColor || '#6495ED';
    // Parse hex to rgb components
    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    document.documentElement.style.setProperty('--stv-vocab-color', color);
    document.documentElement.style.setProperty('--stv-vocab-bg', hexToRgba(color, 0.12));
    document.documentElement.style.setProperty('--stv-vocab-border', hexToRgba(color, 0.5));
    document.documentElement.style.setProperty('--stv-vocab-hover-color', hoverColor);
    document.documentElement.style.setProperty('--stv-vocab-hover-bg', hexToRgba(hoverColor, 0.18));
}

/** Apply theme class to body */
function applyTheme() {
    var settings = getSettings();
    var theme = settings.theme || 'auto';
    document.body.classList.remove('stv-theme-dark', 'stv-theme-light');
    if (theme === 'dark') {
        document.body.classList.add('stv-theme-dark');
    } else if (theme === 'light') {
        document.body.classList.add('stv-theme-light');
    }
    // 'auto' = no class added, uses SillyTavern's default theme variables
}

// ══════════════════════════════════════════════════════
//  VOCABULARY MODULE
// ══════════════════════════════════════════════════════

function getVocab() {
    return getSettings().vocabList || [];
}

/**
 * Build a map: conjugated/inflected form word → { baseWordId, baseWord }
 * Used when highlightWordForms is enabled.
 * If a conjugated form is ALSO individually saved in vocab, it maps to its own entry (priority).
 */
function buildWordFormsMap() {
    var vocab = getVocab();
    var savedWords = new Set(vocab.map(function (w) { return w.word; }));
    var formsMap = {}; // formWord → { baseWordId, baseWord, baseVocabWord }
    vocab.forEach(function (w) {
        if (!w.wordForms || typeof w.wordForms !== 'object') return;
        Object.keys(w.wordForms).forEach(function (groupLabel) {
            var forms = w.wordForms[groupLabel];
            if (!Array.isArray(forms)) return;
            forms.forEach(function (form) {
                var formWord = form.word || '';
                if (!formWord || formWord === w.word) return;
                // Don't overwrite if this form is a separately saved vocab word
                if (savedWords.has(formWord)) return;
                // Don't overwrite if already mapped from another base word (first wins)
                if (formsMap[formWord]) return;
                formsMap[formWord] = { baseWordId: w.id, baseWord: w.word };
            });
        });
    });
    return formsMap;
}

// ── Built-in English Grammar Explanations ─────────────
const ENGLISH_GRAMMAR_EXPLANATIONS = {
    'past tense': {
        name: '과거형',
        description: '과거에 일어난 동작이나 상태를 나타내는 형태.\n규칙 동사는 -ed를 붙이고, 불규칙 동사는 별도의 형태를 가진다.',
        formation: '• 규칙 동사: 어미에 -ed\n  walk → walked, play → played\n  -e로 끝남: -d만 추가 (like → liked)\n  자음+y: y → ied (study → studied)\n  짧은 모음+자음 하나: 자음을 한 번 더 씀 (stop → stopped)\n  ※ 2음절 이상은 강세가 끝에 올 때만 겹침\n    prefer → preferred (강세 뒤 ○)\n    visit → visited (강세 앞 ✗)\n• 불규칙 동사: 개별 암기\n  go → went, see → saw, run → ran',
        usage: '• I walked to school yesterday. (어제 학교에 걸어갔다.)\n• She went home early. (그녀는 일찍 집에 갔다.)\n• They played soccer last week. (그들은 지난주에 축구했다.)',
    },
    'past participle': {
        name: '과거 분사',
        description: '완료 시제, 수동태, 형용사적 용법에 사용되는 동사 형태.\n규칙 동사는 과거형과 동일(-ed), 불규칙 동사는 별도 형태.',
        formation: '• 규칙 동사: 과거형과 동일\n  walked, played, studied\n• 불규칙 동사: 개별 암기 (3단 변화의 세 번째)\n  go → gone, see → seen, write → written\n  eat → eaten, break → broken, take → taken',
        usage: '• 완료: I have eaten lunch. (점심을 먹었다.)\n• 수동: The book was written by her. (그 책은 그녀에 의해 쓰였다.)\n• 형용사: a broken window (깨진 창문)',
    },
    '-ing form': {
        name: '-ing 현재 분사 / 동명사',
        description: '진행형, 동명사(명사 역할), 현재 분사(형용사 역할)로 사용되는 형태.',
        formation: '• 기본: 동사 + -ing\n  walk → walking, eat → eating\n• -e로 끝남: e를 빼고 -ing (make → making)\n• 짧은 모음+자음 하나: 자음을 한 번 더 씀 (run → running, sit → sitting)\n  ※ 2음절 이상은 강세가 끝에 올 때만 겹침\n    prefer → preferring (강세 뒤 ○)\n    visit → visiting (강세 앞 ✗)\n• -ie로 끝남: ie → y + ing (die → dying, lie → lying)',
        usage: '• 진행형: She is reading a book. (그녀는 책을 읽고 있다.)\n• 동명사: Swimming is fun. (수영은 재미있다.)\n• 형용사: an interesting movie (흥미로운 영화)',
    },
    'comparative': {
        name: '비교급',
        description: '두 대상을 비교할 때 사용하는 형용사/부사의 형태.',
        formation: '• 1음절: -er 추가 (tall → taller, fast → faster)\n• -e로 끝남: -r만 추가 (large → larger)\n• 자음+y: y → ier (happy → happier)\n• 2음절 이상: more + 기본형 (beautiful → more beautiful)\n• 불규칙: good → better, bad → worse, far → farther/further',
        usage: '• She is taller than me. (그녀는 나보다 키가 크다.)\n• This book is more interesting. (이 책이 더 흥미롭다.)\n• He runs faster than his brother. (그는 형보다 빨리 달린다.)',
    },
    'superlative': {
        name: '최상급',
        description: '셋 이상의 대상 중 가장 뛰어남을 나타내는 형용사/부사의 형태.',
        formation: '• 1음절: -est 추가 (tall → tallest)\n• -e로 끝남: -st만 추가 (large → largest)\n• 자음+y: y → iest (happy → happiest)\n• 2음절 이상: most + 기본형 (beautiful → most beautiful)\n• 불규칙: good → best, bad → worst, far → farthest/furthest',
        usage: '• She is the tallest in her class. (그녀는 반에서 가장 키가 크다.)\n• This is the most beautiful place. (이곳이 가장 아름다운 곳이다.)',
    },
    'plural': {
        name: '복수형',
        description: '명사가 둘 이상을 나타낼 때의 형태.',
        formation: '• 기본: -s 추가 (cat → cats, book → books)\n• -s/-x/-z/-ch/-sh: -es 추가 (bus → buses, box → boxes)\n• 자음+o: -es 추가 (potato → potatoes, hero → heroes)\n  ※ 외래어·줄임말은 -s만: piano → pianos, photo → photos\n• 자음+y: y → ies (city → cities, baby → babies)\n• -f/-fe: f → ves (knife → knives, leaf → leaves)\n• 불규칙: man → men, child → children, tooth → teeth\n  mouse → mice, person → people, foot → feet\n• 불변: sheep → sheep, fish → fish, deer → deer',
        usage: '• I have two cats. (나는 고양이 두 마리가 있다.)\n• The children are playing. (아이들이 놀고 있다.)',
    },
    '3rd person': {
        name: '3인칭 단수 현재',
        description: '현재 시제에서 3인칭 단수 주어(he/she/it)와 함께 쓰는 동사 형태.',
        formation: '• 기본: -s 추가 (run → runs, like → likes)\n• -s/-x/-z/-ch/-sh/-o: -es 추가 (watch → watches, go → goes, do → does)\n• 자음+y: y → ies (study → studies, fly → flies)\n• 불규칙: have → has, be → is',
        usage: '• He runs every morning. (그는 매일 아침 달린다.)\n• She studies English. (그녀는 영어를 공부한다.)\n• It has a long tail. (그것은 긴 꼬리를 가지고 있다.)',
    },
    'present perfect': {
        name: '현재 완료',
        description: '과거에 시작되어 현재까지 영향을 미치는 동작이나 경험을 나타내는 시제.',
        formation: '• have/has + 과거 분사\n  I have eaten. She has gone.\n• 부정: have/has + not + 과거 분사\n  I haven\'t seen it. She hasn\'t finished.',
        usage: '• 경험: I have visited Japan twice. (일본에 두 번 가 본 적 있다.)\n• 완료: She has already finished. (그녀는 이미 끝냈다.)\n• 계속: I have lived here for 5 years. (5년간 여기 살고 있다.)',
    },
    'past perfect': {
        name: '과거 완료',
        description: '과거의 특정 시점보다 더 이전에 일어난 동작을 나타내는 시제.',
        formation: '• had + 과거 분사\n  I had eaten before she arrived.\n• 부정: had + not + 과거 분사\n  I hadn\'t seen it before.',
        usage: '• 대과거: I had already eaten when she arrived. (그녀가 도착했을 때 나는 이미 먹었었다.)\n• 경험: He had never seen snow before that day. (그날 이전에 그는 눈을 본 적이 없었다.)',
    },
    'future perfect': {
        name: '미래 완료',
        description: '미래의 특정 시점까지 완료될 동작을 나타내는 시제.',
        formation: '• will have + 과거 분사\n  I will have finished by then.\n• 부정: will not have + 과거 분사\n  She won\'t have arrived yet.',
        usage: '• By next year, I will have graduated. (내년이면 졸업해 있을 것이다.)\n• She will have left by the time you arrive. (네가 도착할 때쯤 그녀는 떠나 있을 것이다.)',
    },
    'present continuous': {
        name: '현재 진행형',
        description: '지금 이 순간 진행 중인 동작이나 일시적 상황을 나타내는 시제.',
        formation: '• am/is/are + -ing\n  I am eating. She is running.\n• 부정: am/is/are + not + -ing\n  He isn\'t sleeping.',
        usage: '• 진행: I am studying now. (나는 지금 공부하고 있다.)\n• 일시적: She is living in Seoul this year. (그녀는 올해 서울에 살고 있다.)\n• 가까운 미래: We are leaving tomorrow. (우리는 내일 떠난다.)',
    },
    'past continuous': {
        name: '과거 진행형',
        description: '과거의 특정 시점에 진행 중이던 동작을 나타내는 시제.',
        formation: '• was/were + -ing\n  I was eating when he called.\n• 부정: was/were + not + -ing\n  She wasn\'t sleeping.',
        usage: '• 과거 진행: I was reading when the phone rang. (전화가 울렸을 때 책을 읽고 있었다.)\n• 배경 묘사: The sun was shining and birds were singing. (태양이 빛나고 새들이 노래하고 있었다.)',
    },
    'passive voice': {
        name: '수동태',
        description: '동작을 받는 대상이 주어가 되는 문장 형태.\n예: "나는 책을 읽었다" → "책이 읽혔다"처럼 주어가 바뀐다.',
        formation: '• be동사 + 과거 분사 (+ by 행위자)\n  ※ p.p. = past participle(과거 분사)의 약자\n  현재: is/am/are + 과거 분사\n  과거: was/were + 과거 분사\n  완료: has/have been + 과거 분사\n  진행: is/am/are being + 과거 분사',
        usage: '• The book was written by her. (그 책은 그녀에 의해 쓰였다.)\n• English is spoken worldwide. (영어는 전 세계에서 사용된다.)\n• The cake has been eaten. (케이크가 먹혔다.)',
    },
    'subjunctive': {
        name: '가정법',
        description: '가정, 소망, 제안, 요구 등 사실이 아닌 상황을 나타내는 문법.\n"만약 ~라면"처럼 현실과 다른 상황을 표현한다.',
        formation: '• 가정법 과거: If + 주어 + 과거형, 주어 + would/could + 동사원형\n  If I were you, I would go.\n• 가정법 과거완료: If + 주어 + had + 과거 분사, 주어 + would have + 과거 분사\n  If I had known, I would have helped.\n• 제안/요구: suggest/recommend + that + 주어 + 동사원형\n  I suggest that he go.',
        usage: '• If I were rich, I would travel. (내가 부자라면 여행할 텐데.)\n• I wish I had studied harder. (더 열심히 공부했더라면.)\n• She recommended that he be promoted. (그녀는 그의 승진을 추천했다.)',
    },
    'gerund': {
        name: '동명사',
        description: '동사에 -ing를 붙여 명사 역할을 하게 하는 형태.\n주어, 목적어, 보어 자리에 올 수 있다.',
        formation: '• 동사 + -ing (형태는 현재 분사와 동일)\n  swim → swimming, read → reading',
        usage: '• 주어: Swimming is good exercise. (수영은 좋은 운동이다.)\n• 목적어: I enjoy reading. (나는 독서를 즐긴다.)\n• 전치사 뒤: She is good at cooking. (그녀는 요리를 잘한다.)',
    },
    'infinitive': {
        name: '부정사',
        description: 'to + 동사원형의 형태. 명사, 형용사, 부사 역할을 한다.',
        formation: '• to + 동사 원형\n  to go, to eat, to study\n• 부정: not to + 동사 원형\n  not to go\n• 원형 부정사 (to 생략): 사역/지각 동사 뒤\n  let him go, watch her dance',
        usage: '• 명사: To read is fun. (읽는 것은 재미있다.)\n• 형용사: I have something to eat. (먹을 것이 있다.)\n• 부사(목적): I went to the store to buy milk. (우유를 사러 가게에 갔다.)\n• 원형 부정사: She let me go. (그녀는 나를 보내줬다.)\n• 지각 동사: I watched her dance. (나는 그녀가 춤추는 것을 보았다.)',
    },
    'conditional': {
        name: '조건문',
        description: '조건과 결과를 나타내는 문장 구조. 4가지 유형이 있다.',
        formation: '• Zero: If + 주어 + 현재동사, 주어 + 현재동사 (일반적 사실)\n• 1st: If + 주어 + 현재동사, 주어 + will + 동사원형 (가능한 미래)\n• 2nd: If + 주어 + 과거동사, 주어 + would + 동사원형 (비현실 가정)\n• 3rd: If + 주어 + had + 과거 분사, 주어 + would have + 과거 분사 (과거 비현실)',
        usage: '• Zero: If you heat water, it boils. (물을 가열하면 끓는다.)\n• 1st: If it rains, I will stay home. (비가 오면 집에 있겠다.)\n• 2nd: If I were you, I would accept. (내가 너라면 수락하겠다.)\n• 3rd: If I had known, I would have come. (알았더라면 왔을 텐데.)',
    },
    'relative clause': {
        name: '관계절',
        description: '관계대명사(who, which, that, whose, whom)로 시작하여 명사를 수식하는 절.',
        formation: '• 사람: who/that (주격), whom/that (목적격), whose (소유격)\n• 사물: which/that (주격/목적격), whose/of which (소유격)\n• 제한적 용법: 콤마 없음 (필수 정보)\n• 비제한적 용법: 콤마 있음 (부가 정보)',
        usage: '• The man who called you is here. (당신에게 전화한 남자가 여기 있다.)\n• The book which I read was great. (내가 읽은 책은 훌륭했다.)\n• She has a friend whose father is a doctor. (그녀에게는 아버지가 의사인 친구가 있다.)',
    },

    // ── 조동사 ──
    'modal verb': {
        name: '조동사',
        description: '본동사 앞에서 가능, 허가, 의무, 추측 등의 의미를 더하는 동사.\n조동사 뒤에는 항상 동사 원형이 온다.',
        formation: '• can/could: 능력·허가·가능성\n• may/might: 허가·추측\n• will/would: 의지·미래·정중한 요청\n• shall/should: 제안·의무·충고\n• must: 강한 의무·확실한 추측\n• need: 필요 (부정문/의문문)\n• dare: 감히 ~하다',
        usage: '• Can you swim? (수영할 수 있니?)\n• You should study harder. (더 열심히 공부해야 한다.)\n• She must be tired. (그녀는 틀림없이 피곤할 것이다.)\n• It might rain tomorrow. (내일 비가 올지도 모른다.)',
    },
    'modal perfect': {
        name: '조동사 완료형',
        description: '조동사와 완료형(have + 과거 분사)을 결합하여 과거에 대한 추측, 후회, 비난 등을 표현.',
        formation: '• must have + 과거 분사: ~했음에 틀림없다 (확신 추측)\n• may/might have + 과거 분사: ~했을지도 모른다 (불확실 추측)\n• could have + 과거 분사: ~할 수도 있었다 (미실현 가능성)\n• should have + 과거 분사: ~했어야 했다 (후회/비난)\n• would have + 과거 분사: ~했을 것이다 (가정 결과)\n• needn\'t have + 과거 분사: ~할 필요 없었다 (불필요한 행동)',
        usage: '• She must have forgotten. (그녀는 잊었음에 틀림없다.)\n• You should have told me. (나한테 말했어야 했다.)\n• He could have won. (그는 이길 수도 있었다.)\n• I needn\'t have hurried. (서두를 필요 없었다.)',
    },

    // ── 전치사 ──
    'preposition': {
        name: '전치사',
        description: '명사/대명사 앞에 놓여 장소, 시간, 방향, 원인 등의 관계를 나타내는 말.',
        formation: '• 장소: in (안에), on (위에), at (지점), by (옆에), under (아래)\n  between (사이에), behind (뒤에), in front of (앞에)\n• 시간: at (시각), on (요일/날짜), in (월/년/계절)\n  before (전에), after (후에), during (~동안), since (~이래)\n• 방향: to (~로), from (~에서), into (안으로), through (통과해)\n• 기타: by (~에 의해), with (~와 함께), for (~를 위해)\n  about (~에 관해), without (~없이)',
        usage: '• I live in Seoul. (서울에 산다.)\n• We met at 3 o\'clock on Monday. (월요일 3시에 만났다.)\n• She walked through the park. (그녀는 공원을 관통해 걸었다.)\n• This was made by my mother. (이것은 어머니가 만드셨다.)',
    },
    'phrasal verb': {
        name: '구동사',
        description: '동사 + 부사/전치사가 결합하여 본래 동사와 다른 새로운 뜻을 갖는 표현.\n영어 일상 회화에서 매우 중요하다.',
        formation: '• 동사 + 부사: 목적어가 대명사이면 사이에 넣음\n  turn off the light / turn it off (✓)\n  turn off it (✗)\n• 동사 + 전치사: 분리 불가\n  look after the baby (✓)\n  look the baby after (✗)\n• 동사 + 부사 + 전치사: 3단어\n  look forward to, put up with',
        usage: '• Please turn off the TV. (TV를 꺼주세요.)\n• I look forward to your reply. (답장을 기대합니다.)\n• She gave up smoking. (그녀는 담배를 끊었다.)\n• Let\'s put off the meeting. (회의를 미루자.)',
    },

    // ── 관사 ──
    'article': {
        name: '관사',
        description: '명사 앞에 놓여 "어떤 것"인지, "그 것"인지를 구별해주는 말.\na/an은 "하나의~", the는 "그~"라는 뜻이다.',
        formation: '• a/an (부정관사): 정해지지 않은 하나의 명사\n  a book, an apple (모음 소리 앞: an)\n• the (정관사): 이미 알고 있는 특정 명사 (단수/복수 모두 가능)\n  the book, the water, the students\n• 무관사: 일반적인 이야기, 고유명사 등\n  Cats are cute. (고양이는 귀엽다 — 일반적인 이야기)',
        usage: '• I saw a cat. The cat was black. (고양이를 보았다. 그 고양이는 검었다.)\n• She plays the piano. (그녀는 피아노를 친다.)\n• Water is essential. (물은 필수적이다.)',
    },

    // ── 접속사 ──
    'conjunction': {
        name: '접속사',
        description: '단어, 구, 절을 연결하는 역할을 하는 품사.',
        formation: '• 등위접속사: and, but, or, nor, for, so, yet\n  두 대등한 요소를 연결\n• 종속접속사: because, although, if, when, while, since, until, unless, after, before, that\n  주절에 종속절을 연결\n• 상관접속사: both A and B, either A or B, neither A nor B, not only A but also B',
        usage: '• 등위: I like tea and coffee. (차와 커피를 좋아한다.)\n• 종속: I stayed home because it rained. (비가 와서 집에 있었다.)\n• 상관: Both he and she are students. (그와 그녀 둘 다 학생이다.)\n• Although it was late, she kept studying. (늦었지만 그녀는 계속 공부했다.)',
    },

    // ── 기타 중요 문법 ──
    'reported speech': {
        name: '간접 화법',
        description: '다른 사람의 말을 전달할 때, 직접 인용 대신 자기 관점으로 바꾸어 말하는 표현.\n시제가 한 단계 과거로 바뀌는 것이 핵심이다.',
        formation: '• 평서문: say/tell + (that) + 시제를 한 단계 과거로\n  "I am happy" → She said (that) she was happy.\n• 의문문: ask + if/whether (Yes/No) 또는 의문사 + 평서문 어순\n  "Do you like it?" → He asked if I liked it.\n• 명령문: tell/ask + 목적어 + to 부정사\n  "Sit down" → She told me to sit down.',
        usage: '• 시제 변화: He said he was tired. (그는 피곤하다고 말했다.)\n• 의문 전달: She asked where I lived. (그녀는 내가 어디에 사는지 물었다.)\n• 명령 전달: He told me to wait. (그는 나에게 기다리라고 말했다.)',
    },
    'causative': {
        name: '사역 구문',
        description: '다른 사람에게 어떤 동작을 하게 시키거나 경험하게 되는 것을 표현.',
        formation: '• make + 목적어 + 동사원형: (강제로) ~하게 하다\n• have + 목적어 + 동사원형: ~하게 하다 (의뢰/지시)\n• let + 목적어 + 동사원형: ~하게 허락하다\n• get + 목적어 + to부정사: (설득하여) ~하게 하다\n• have/get + 목적어 + 과거 분사: ~을 당하다/~을 시키다',
        usage: '• She made me cry. (그녀가 나를 울게 했다.)\n• I had him fix my car. (내 차를 그에게 고치게 했다.)\n• Let me help you. (내가 도와줄게.)\n• I got my hair cut. (머리를 잘랐다 — 미용실에서.)',
    },
    'emphatic': {
        name: '강조 구문',
        description: 'do/does/did를 본동사 앞에 넣어 동작을 강조하는 구문.',
        formation: '• do/does + 동사원형 (현재)\n  I do like it.\n• did + 동사원형 (과거)\n  She did come yesterday.',
        usage: '• I do love this song. (나는 이 노래를 정말 좋아한다.)\n• She does work hard. (그녀는 정말 열심히 일한다.)\n• He did call you. (그가 정말 너에게 전화했어.)',
    },
    'cleft sentence': {
        name: '분열문',
        description: '문장의 특정 요소를 강조하기 위해 구조를 분리하는 문법.',
        formation: '• It is/was ~ that/who ...\n  It was John who broke the window.\n• What ~ is/was ...\n  What I need is a vacation.',
        usage: '• It was yesterday that we met. (우리가 만난 건 어제였다.)\n• What she said was true. (그녀가 말한 것은 사실이었다.)\n• It is the result that matters. (중요한 것은 결과다.)',
    },
    'inversion': {
        name: '도치',
        description: '주어와 동사/조동사의 어순을 바꾸어 강조하거나 형식을 갖추는 구문.',
        formation: '• 부정 부사 도치: Never/Rarely/Seldom/Hardly/Not only + 조동사 + 주어 + 동사\n• so/neither 도치: So do I. / Neither did she.\n• 조건문 도치: Had I known = If I had known\n  Were I you = If I were you',
        usage: '• Never have I seen such beauty. (이토록 아름다운 것을 본 적이 없다.)\n• Rarely does he make mistakes. (그는 좀처럼 실수하지 않는다.)\n• Not only did she sing, but she also danced. (그녀는 노래뿐만 아니라 춤도 췄다.)',
    },
};

// Korean key aliases → reference to English-keyed entries above.
// Allows lookup by Korean labels (from LLM prompt) AND legacy English labels.
const KOREAN_TO_ENGLISH_GRAMMAR_MAP = {
    '과거형': 'past tense', '과거 분사': 'past participle', '-ing형': '-ing form',
    '현재 분사': '-ing form', '3인칭 단수 현재': '3rd person',
    '비교급': 'comparative', '최상급': 'superlative', '복수형': 'plural',
    '3인칭 단수': '3rd person', '현재 완료': 'present perfect', '과거 완료': 'past perfect',
    '미래 완료': 'future perfect', '현재 진행형': 'present continuous', '과거 진행형': 'past continuous',
    '수동태': 'passive voice', '가정법': 'subjunctive', '동명사': 'gerund',
    '부정사': 'infinitive', '조건문': 'conditional', '관계절': 'relative clause',
    '조동사': 'modal verb', '조동사 완료형': 'modal perfect',
    '전치사': 'preposition', '구동사': 'phrasal verb', '관사': 'article',
    '접속사': 'conjunction', '간접 화법': 'reported speech', '사역 구문': 'causative',
    '강조 구문': 'emphatic', '분열문': 'cleft sentence', '도치': 'inversion',
};
(function () {
    for (var ko in KOREAN_TO_ENGLISH_GRAMMAR_MAP) {
        var en = KOREAN_TO_ENGLISH_GRAMMAR_MAP[ko];
        if (!ENGLISH_GRAMMAR_EXPLANATIONS[ko] && ENGLISH_GRAMMAR_EXPLANATIONS[en]) {
            ENGLISH_GRAMMAR_EXPLANATIONS[ko] = ENGLISH_GRAMMAR_EXPLANATIONS[en];
        }
    }
})();

// ── Built-in English Verb Type Explanations ───────────
const ENGLISH_VERB_TYPE_EXPLANATIONS = {
    'regular': {
        name: '규칙 동사',
        description: '과거형과 과거 분사형을 만들 때 어미에 -ed를 규칙적으로 붙이는 동사.',
        rules: [
            '• 기본: 동사 + -ed (walk → walked → walked)',
            '• -e로 끝남: -d만 추가 (like → liked → liked)',
            '• 자음+y: y → ied (study → studied → studied)',
            '• 짧은 모음+자음 하나: 자음을 한 번 더 씀 (stop → stopped → stopped)',
            '  ※ 2음절 이상은 강세가 끝에 올 때만 겹침 (prefer → preferred)',
        ],
        examples: 'walk, talk, play, study, like, love, want, need, help',
        tip: '대부분의 영어 동사는 규칙 동사입니다. 패턴을 익히면 과거형/과거 분사를 쉽게 만들 수 있습니다.',
    },
    'irregular': {
        name: '불규칙 동사',
        description: '과거형과 과거 분사형이 -ed 규칙을 따르지 않고 개별적인 형태를 가지는 동사.\n3단 변화(원형 - 과거 - 과거분사)를 암기해야 한다.',
        rules: [
            '• A-B-C형: 셋 다 다름 (go → went → gone, see → saw → seen)',
            '• A-B-B형: 과거와 과거분사 동일 (buy → bought → bought, teach → taught → taught)',
            '• A-B-A형: 원형과 과거분사 동일 (come → came → come, run → ran → run)',
            '• A-A-A형: 셋 다 동일 (cut → cut → cut, put → put → put)',
        ],
        examples: 'go/went/gone, see/saw/seen, eat/ate/eaten, take/took/taken, break/broke/broken, write/wrote/written',
        tip: '가장 자주 쓰이는 불규칙 동사는 약 200개 정도이며, 대부분 일상 기본 어휘입니다. 패턴별로 묶어서 외우면 효율적입니다.',
    },
};

// ── Built-in Grammar Explanations ─────────────────────
// Maps grammar form keywords → Korean descriptions for modal display.
// Keys use the Korean-localized labels matching LLM prompt output.

const GRAMMAR_EXPLANATIONS = {
    // ── 6활용형 (학교문법) ──
    '미연형': {
        name: '未然形',
        description: '아직 일어나지 않은 상태를 나타내는 활용형.\n부정(ない), 수동(れる/られる), 사역(せる/させる) 등의 조동사가 접속한다.',
        formation: '• 五段동사: 어미를 あ단으로 변환\n  書く → 書か(ない), 飲む → 飲ま(ない)\n• 一段동사: る를 제거\n  食べる → 食べ(ない), 見る → 見(ない)\n• 불규칙: する → し(ない), くる → こ(ない)',
        usage: '• 부정: 書かない (쓰지 않다)\n• 수동: 書かれる (쓰이다)\n• 사역: 書かせる (쓰게 하다)',
    },
    '연용형': {
        name: '連用形',
        description: 'ます형, て형, た형의 기반이 되는 핵심 활용형.\n동사의 연용형은 그 자체로 명사화되기도 한다 (예: 休み=쉼/휴가).',
        formation: '• 五段동사: 어미를 い단으로 변환\n  書く → 書き, 飲む → 飲み, 走る → 走り\n• 一段동사: る를 제거\n  食べる → 食べ, 見る → 見\n• 불규칙: する → し, くる → き',
        usage: '• ます 접속: 書きます (씁니다)\n• 명사화: 休み (쉼/휴가), 始まり (시작)\n• 복합동사: 飛び出す (뛰어나가다)\n• 중지법: 朝起き、顔を洗った (아침에 일어나, 세수했다)',
    },
    '종지형': {
        name: '終止形',
        description: '문장을 끝맺는 형태. 사전에 실리는 기본형(사전형)과 동일하다.\n현대 일본어에서는 연체형과 형태가 같다.',
        formation: '• 동사: 사전형 그대로\n  書く, 食べる, する, くる\n• い형용사: 美しい, 高い\n• な형용사: 静かだ, きれいだ',
        usage: '• 문장 종결: 私は本を読む。 (나는 책을 읽는다.)\n• ~と思う 앞: 行くと思う (갈 거라 생각하다)',
    },
    '연체형': {
        name: '連体形',
        description: '체언(명사)을 수식하는 활용형.\n현대 일본어에서 종지형과 형태가 동일하지만, な형용사와 명사에서는 다르다.',
        formation: '• 동사: 종지형과 동일\n  書く(人), 食べる(もの)\n• い형용사: 美しい(花)\n• な형용사: 静かな(夜)  ← だ가 な으로 변화',
        usage: '• 명사 수식: 読む本 (읽는 책)\n• ~のだ/~のです: 行くのです (가는 것입니다)\n• ~ことができる: 泳ぐことができる (수영할 수 있다)',
    },
    '가정형': {
        name: '仮定形',
        description: '조건을 나타내는 조사 ば가 접속하는 활용형.\n「~하면」이라는 가정 조건을 표현한다.',
        formation: '• 五段동사: 어미를 え단으로 변환 + ば\n  書く → 書けば, 飲む → 飲めば\n• 一段동사: る → れば\n  食べる → 食べれば, 見る → 見れば\n• い형용사: い → ければ\n  高い → 高ければ\n• 불규칙: する → すれば, くる → くれば',
        usage: '• 조건: 勉強すれば合格する (공부하면 합격한다)\n• 가정: もっと早く起きれば、間に合った (더 일찍 일어났으면 맞았을 텐데)',
    },
    '명령형': {
        name: '命令形',
        description: '상대에게 직접 명령하는 활용형.\n일상 회화에서는 거칠게 들리므로 주의가 필요하다.',
        formation: '• 五段동사: 어미를 え단으로 변환\n  書く → 書け, 飲む → 飲め, 走る → 走れ\n• 一段동사: る → ろ (또는 よ)\n  食べる → 食べろ, 見る → 見ろ\n• 불규칙: する → しろ/せよ, くる → こい',
        usage: '• 직접 명령: 立て! (일어서!)\n• 응원: 頑張れ! (힘내!)\n• 표지판: 止まれ (멈춰라)',
    },

    // ── 접속·활용형 ──
    'て형': {
        name: 'て形',
        description: '동작의 연결, 요청, 진행, 원인 등 다양한 용법을 갖는 활용형.\n연용형 기반으로 て/で가 붙는다.',
        formation: '• 五段 음편 변화:\n  く → いて (書く→書いて), ぐ → いで (泳ぐ→泳いで)\n  す → して (話す→話して)\n  む/ぶ/ぬ → んで (飲む→飲んで, 遊ぶ→遊んで)\n  る/つ/う → って (走る→走って, 待つ→待って)\n• 一段: る → て  (食べる→食べて)\n• 불규칙: する→して, くる→きて, 行く→行って',
        usage: '• 연결: 食べて寝る (먹고 자다)\n• 요청: 教えてください (가르쳐 주세요)\n• 진행: 食べている (먹고 있다)\n• 원인: 嬉しくて泣いた (기뻐서 울었다)',
    },
    'た형': {
        name: 'た形',
        description: '과거·완료를 나타내는 활용형.\nて형과 같은 음편 규칙을 따르며, て→た, で→だ로 바꾸면 된다.',
        formation: '• て형의 て→た, で→だ:\n  書いて → 書いた, 飲んで → 飲んだ\n  食べて → 食べた, して → した',
        usage: '• 과거: 昨日、本を読んだ (어제 책을 읽었다)\n• 완료: もう食べた (이미 먹었다)\n• 경험: 行ったことがある (간 적이 있다)\n• 발견: あ、ここにあった！ (아, 여기 있었네!)',
    },
    'ます형': {
        name: 'ます形',
        description: '정중체(です·ます체)를 만드는 활용형.\n연용형에 ます를 붙인 형태이다.',
        formation: '• 연용형 + ます:\n  書く → 書きます, 飲む → 飲みます\n  食べる → 食べます, する → します, くる → きます',
        usage: '• 정중: 毎日勉強します (매일 공부합니다)\n• 과거 정중: 昨日行きました (어제 갔습니다)\n• 부정 정중: 食べません (먹지 않습니다)\n• 의지 정중: 行きましょう (갑시다)',
    },
    'ない형': {
        name: 'ない形',
        description: '동사의 부정형. 미연형에 ない를 붙인 형태이다.\nない 자체가 い형용사처럼 활용한다.',
        formation: '• 미연형 + ない:\n  書く → 書かない, 飲む → 飲まない\n  食べる → 食べない, する → しない, くる → こない\n• 특수: ある → ない (あらない ✗)',
        usage: '• 부정: 食べない (먹지 않는다)\n• 부정 과거: 食べなかった (먹지 않았다)\n• ~なければならない: 行かなければならない (가지 않으면 안 된다)\n• ~ないでください: 触らないでください (만지지 마세요)',
    },
    'ば형': {
        name: 'ば形',
        description: '가정 조건 「~하면」을 나타내는 형태.\n가정형에 ば를 붙인 것이다.',
        formation: '• 가정형 + ば:\n  書く → 書けば, 食べる → 食べれば\n  する → すれば, くる → くれば\n• い형용사: 高い → 高ければ\n• ない: なければ',
        usage: '• 가정: 安ければ買う (싸면 산다)\n• 격언: 塵も積もれば山となる (티끌 모아 태산)\n• 후회: あの時行けばよかった (그때 갔으면 좋았을 텐데)',
    },
    '수동형': {
        name: '受身形',
        description: '동작을 받는 쪽의 입장에서 말하는 수동 표현.\n미연형에 れる/られる를 붙인다.',
        formation: '• 五段동사: 미연형 + れる\n  書く → 書かれる, 飲む → 飲まれる\n• 一段동사: 미연형 + られる\n  食べる → 食べられる, 見る → 見られる\n• 불규칙: する → される, くる → こられる',
        usage: '• 직접 수동: 先生に褒められた (선생님에게 칭찬받았다)\n• 간접 수동 (피해): 雨に降られた (비를 맞았다)\n• 존경 표현으로도 사용: 先生が読まれた (선생님이 읽으셨다)',
    },
    '사역형': {
        name: '使役形',
        description: '다른 사람에게 동작을 시키거나 허용하는 사역 표현.\n미연형에 せる/させる를 붙인다.',
        formation: '• 五段동사: 미연형 + せる\n  書く → 書かせる, 飲む → 飲ませる\n• 一段동사: 미연형 + させる\n  食べる → 食べさせる, 見る → 見させる\n• 불규칙: する → させる, くる → こさせる',
        usage: '• 강제: 子供に野菜を食べさせる (아이에게 채소를 먹게 하다)\n• 허용: 好きにさせてあげる (하고 싶은 대로 하게 해주다)\n• 감정 사역: 泣かせる (울게 하다)',
    },
    '사역수동': {
        name: '使役受身形',
        description: '사역+수동이 결합된 형태. 「(억지로) ~하게 되다」의 의미.\n사역형에 수동 접미사가 붙는다.',
        formation: '• 五段동사: 미연형 + される (축약형)\n  書く → 書かされる, 飲む → 飲まされる\n  ※「す」로 끝나는 동사는 축약 불가 (話す → 話させられる)\n• 一段동사: させられる\n  食べる → 食べさせられる\n• 불규칙: する → させられる, くる → こさせられる',
        usage: '• 嫌いな野菜を食べさせられた\n  (싫어하는 채소를 억지로 먹게 되었다)\n• 毎日走らされる\n  (매일 (억지로) 뛰게 된다)',
    },
    '가능형': {
        name: '可能形',
        description: '「~할 수 있다」의 능력·가능을 나타내는 형태.',
        formation: '• 五段동사: 어미를 え단으로 변환 + る\n  書く → 書ける, 飲む → 飲める, 読む → 読める\n• 一段동사: られる (= 수동형과 동형)\n  食べる → 食べられる (구어에선 食べれる)\n• 불규칙: する → できる, くる → こられる (これる)',
        usage: '• 능력: 日本語が話せる (일본어를 할 수 있다)\n• 상황: 今日は早く帰れる (오늘은 일찍 돌아갈 수 있다)\n• ら抜き: 食べれる (※구어체 전용. 공식 문서나 시험에서는 食べられる가 정답)',
    },
    '의향형': {
        name: '意向形',
        description: '의지(~하겠다)나 권유(~하자)를 나타내는 형태.',
        formation: '• 五段동사: 어미를 お단으로 변환 + う\n  書く → 書こう, 飲む → 飲もう\n• 一段동사: る → よう\n  食べる → 食べよう, 見る → 見よう\n• 불규칙: する → しよう, くる → こよう',
        usage: '• 의지: 明日からがんばろう (내일부터 열심히 하겠다)\n• 권유: 一緒に行こう (같이 가자)\n• ~としている: 出ようとしている (나가려 하고 있다)',
    },

    // ── 형용사 활용 ──
    'い형용사': {
        name: 'イ形容詞',
        description: 'い형용사(형용사)는 어미 い가 변화하며 활용한다.\nない도 い형용사의 일종이므로 같은 규칙을 따른다.',
        formation: '• 부정: い → くない  (高い → 高くない)\n• 과거: い → かった  (高い → 高かった)\n• 부정과거: い → くなかった\n• て형: い → くて  (高い → 高くて)\n• 연용형: い → く  (高い → 高く)\n• 가정: い → ければ  (高い → 高ければ)',
        usage: '• この本は高い (이 책은 비싸다)\n• 高くない (비싸지 않다)\n• 高かった (비쌌다)\n• 高くて買えない (비싸서 살 수 없다)',
    },
    'な형용사': {
        name: 'ナ形容詞 (형용동사)',
        description: 'な형용사(형용동사)는 명사를 수식할 때 な가 붙고, だ를 기반으로 활용한다.',
        formation: '• 명사 수식: な  (静かな夜)\n• 부정: ではない/じゃない  (静かではない)\n• 과거: だった  (静かだった)\n• て형: で  (静かで)\n• 연용형: に  (静かに)\n• ~そう (양태): 静かそうだ',
        usage: '• 静かな部屋 (조용한 방)\n• 元気じゃない (건강하지 않다)\n• きれいだった (예뻤다)\n• 静かにしてください (조용히 해주세요)',
    },

    // ── 기타 중요 문법형 ──
    '명사화': {
        name: '名詞化',
        description: '동사나 형용사를 명사로 바꾸는 문법.',
        formation: '• ~こと: 가장 일반적인 명사화\n  読むこと (읽는 것), 走ること (뛰는 것)\n• ~の: 구어에서 자주 사용\n  走るのが好き (뛰는 게 좋다)\n• 연용형 명사: 동사의 연용형이 명사로 굳어진 것\n  休み (쉼/휴가), 話 (이야기)',
        usage: '• 読むことが大切だ (읽는 것이 중요하다)\n• 食べるのをやめた (먹는 것을 그만두었다)\n• 泳ぎが上手だ (수영을 잘한다)\n• ※팁: 見る/聞く/手伝う 앞에서는 「の」만 사용 (走っているのを見た)',
    },
    '존경어': {
        name: '尊敬語',
        description: '상대나 제3자의 행동을 높여 말하는 경어 표현.',
        formation: '• お + 연용형 + になる:\n  読む → お読みになる\n• 수동형으로 존경:\n  読む → 読まれる\n• 특수 존경어:\n  いる → いらっしゃる, 食べる → 召し上がる\n  言う → おっしゃる, 行く/来る → いらっしゃる',
        usage: '• 先生がお読みになった (선생님이 읽으셨다)\n• 社長が来られました (사장님이 오셨습니다)\n• 何を召し上がりますか (무엇을 드시겠습니까)',
    },
    '겸양어': {
        name: '謙譲語',
        description: '자신이나 자기 쪽의 행동을 낮추어 상대를 높이는 경어 표현.',
        formation: '• お + 연용형 + する/いたす:\n  読む → お読みする/お読みいたす\n• 특수 겸양어:\n  行く/来る → 参る, 食べる → いただく\n  言う → 申す, 見る → 拝見する\n  もらう → いただく, する → いたす',
        usage: '• 荷物をお持ちします (짐을 들어드리겠습니다)\n• 明日参ります (내일 찾아뵙겠습니다)\n• 拝見しました (보았습니다 — 겸양)',
    },
    '진행형': {
        name: '~ている',
        description: '동작의 진행, 결과 상태의 지속, 반복 습관을 나타낸다.',
        formation: '• て형 + いる:\n  食べている (먹고 있다)\n  知っている (알고 있다)\n• 구어 축약: ~てる\n  食べてる, 知ってる',
        usage: '• 진행: 今食べている (지금 먹고 있다)\n• 상태: 結婚している (결혼한 상태이다)\n• 습관: 毎日走っている (매일 뛰고 있다)\n• 경험 결과: もう読んでいる (이미 읽어 놓았다)',
    },
    '과거형': {
        name: '過去形',
        description: 'た형과 동일. 과거 또는 완료를 나타낸다.',
        formation: 'た형 참조.\n• 정중체: ~ました (食べました)\n• 부정 과거: ~なかった (食べなかった)\n• 정중 부정 과거: ~ませんでした (食べませんでした)',
        usage: '• 昨日映画を見た (어제 영화를 봤다)\n• もう終わった (이미 끝났다)',
    },
    '부정형': {
        name: '否定形',
        description: 'ない형과 동일. 동작이나 상태의 부정을 나타낸다.',
        formation: 'ない형 참조.\n• 부정 의지: ~まい (行くまい)\n• 고어 부정: ~ず (知らず = 모르고)',
        usage: '• 今日は行かない (오늘은 가지 않는다)\n• 知らず知らず (모르는 사이에)',
    },

    // ── 조건·기타 형태 ──
    'たら형': {
        name: 'たら形',
        description: '「~하면/~했더니」의 조건·가정을 나타내는 형태.\nた형에 ら를 붙인 것이다.',
        formation: '• た형 + ら:\n  書いた → 書いたら, 食べた → 食べたら\n  した → したら, 高かった → 高かったら',
        usage: '• 가정: 雨が降ったら行かない (비가 오면 안 간다)\n• 발견: 窓を開けたら猫がいた (창문을 열었더니 고양이가 있었다)',
    },
    'と형': {
        name: 'と 조건형',
        description: '종지형에 と를 붙여 「~하면 (필연적으로)」의 의미를 나타낸다.\n자연법칙이나 반복적 사실에 자주 사용.',
        formation: '• 종지형 + と:\n  押す → 押すと, 春になる → 春になると',
        usage: '• 법칙: ボタンを押すと音が鳴る (버튼을 누르면 소리가 난다)\n• 자연현상: 春になると花が咲く (봄이 되면 꽃이 핀다)',
    },
    '금지형': {
        name: '禁止形',
        description: '「~하지 마(라)」의 부정 명령을 나타내는 형태.\n종지형(사전형)에 な를 붙인다.',
        formation: '• 종지형 + な:\n  書く → 書くな, 食べる → 食べるな\n  する → するな, くる → くるな',
        usage: '• 직접 금지: 触るな! (만지지 마!)\n• 응원: 諦めるな! (포기하지 마!)\n• 표지판: 入るな (들어가지 마라)',
    },
    'なら형': {
        name: 'なら 조건형',
        description: '상대의 말을 받아치거나 주제를 한정할 때 쓰는 조건 표현.\n「~라면/~라고 한다면」의 의미.',
        formation: '• 종지형/명사/な형용사 + なら:\n  行く → 行くなら, 学生 → 学生なら\n  静か → 静かなら',
        usage: '• 주제 한정: 東京に行くなら、新幹線がいい (도쿄에 간다면, 신칸센이 좋다)\n• 상대 말 수용: 暇なら手伝って (한가하다면 도와줘)',
    },
};

// ── Built-in Verb Group Explanations ──────────────────
const VERB_GROUP_EXPLANATIONS = {
    '五段': {
        name: '5단 동사',
        description: '어미가 う단(う/く/す/つ/ぬ/ぶ/む/る/ぐ)으로 끝나는 동사.\n활용 시 어미가 あ/い/う/え/お의 5단으로 변화한다.',
        rules: [
            '• 미연형: う단 → あ단 + ない (書く → 書かない)',
            '• 연용형: う단 → い단 + ます (書く → 書きます)',
            '• て형: 음편 변화 (書く → 書いて, 飲む → 飲んで) ※예외: 行く → 行って',
            '• 가정형: う단 → え단 + ば (書く → 書けば)',
            '• 명령형: う단 → え단 (書く → 書け)'
        ],
        examples: '書く, 読む, 走る, 買う, 話す, 泳ぐ, 待つ, 死ぬ, 遊ぶ',
        tip: '「~る」로 끝나도 る 앞의 모음이 あ/う/お단이면 반드시 五段 (例: 分かる, 作る, 通る).\nい/え단이라도 五段인 예외가 있으므로 주의 (例: 走る, 帰る, 知る, 切る)'
    },
    '一段': {
        name: '1단 동사',
        description: '어미가 항상 「る」로 끝나며, る 앞의 모음이 い단 또는 え단인 동사.\n활용 시 る를 떼고 접미사를 붙이므로, 어간이 변하지 않는다.',
        rules: [
            '• 미연형: る → ない (食べる → 食べない)',
            '• 연용형: る → ます (食べる → 食べます)',
            '• て형: る → て (食べる → 食べて)',
            '• 가정형: る → れば (食べる → 食べれば)',
            '• 명령형: る → ろ/よ (食べる → 食べろ)'
        ],
        examples: '食べる, 見る, 起きる, 寝る, 開ける, 教える, 落ちる',
        tip: '上一段(い단): 見る, 起きる, 降りる\n下一段(え단): 食べる, 教える, 出る'
    },
    'サ変': {
        name: 'する 동사 (サ변 불규칙 활용)',
        description: '「する」및 「~する」형태의 동사.\n한자어+する 형태가 가장 많다 (勉強する, 運動する 등).',
        rules: [
            '• 미연형: し/せ/さ (しない, させる, される)',
            '• 연용형: し (します, して)',
            '• 가정형: すれば',
            '• 명령형: しろ(구어체) / せよ(문어체)'
        ],
        examples: 'する, 勉強する, 運動する, 料理する, 旅行する, 心配する',
        tip: '한자어(勉強), 외래어(コピー), 상태 명사(音, 匂い) 등에 + する가 붙는 형태는 모두 サ변에 해당'
    },
    'カ変': {
        name: 'くる 동사 (カ변 불규칙 활용)',
        description: '「来る(くる)」한 단어만 해당하는 특수 활용.\n어간(来=く/き/こ)이 불규칙하게 변화한다.',
        rules: [
            '• 미연형: 来(こ)ない',
            '• 연용형: 来(き)ます, 来(き)て',
            '• 종지형: 来(く)る',
            '• 가정형: 来(く)れば',
            '• 명령형: 来(こ)い'
        ],
        examples: '来る (및 복합어: 持ってくる, 連れてくる)',
        tip: '일본어에서 유일한 カ변 동사'
    }
};

/**
 * Show a read-only modal with verb group explanation.
 */
function showVerbGroupInfoModal(group, language) {
    var existing = document.getElementById('stv-grammar-modal-overlay');
    if (existing) existing.remove();

    var info = (language === 'en') ? ENGLISH_VERB_TYPE_EXPLANATIONS[group] : VERB_GROUP_EXPLANATIONS[group];
    if (!info && language !== 'en') info = ENGLISH_VERB_TYPE_EXPLANATIONS[group];
    if (!info && language === 'en') info = VERB_GROUP_EXPLANATIONS[group];

    var overlay = document.createElement('div');
    overlay.id = 'stv-grammar-modal-overlay';
    overlay.className = 'stv-dialog-overlay';

    if (!info) {
        overlay.innerHTML = '<div class="stv-dialog stv-grammar-modal">'
            + '<div class="stv-dialog-header"><h3>동사 그룹 정보</h3>'
            + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
            + '<div class="stv-dialog-body"><p>' + escapeHtml(group) + '에 대한 상세 정보가 없습니다.</p></div>'
            + '<div class="stv-dialog-footer"><button class="stv-btn stv-btn-cancel stv-grammar-close">닫기</button></div></div>';
    } else {
        var rulesText = info.rules.join('\n');
        overlay.innerHTML = '<div class="stv-dialog stv-grammar-modal">'
            + '<div class="stv-dialog-header"><h3>동사 그룹 정보</h3>'
            + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
            + '<div class="stv-dialog-body">'
            + '<span class="stv-verb-group-badge stv-verb-group-' + group + '">' + escapeHtml(group) + '</span>'
            + '<h4 class="stv-grammar-name">' + escapeHtml(info.name) + '</h4>'
            + '<div class="stv-grammar-section">'
            + '<div class="stv-grammar-section-title">설명</div>'
            + '<div class="stv-grammar-section-body">' + escapeHtml(info.description).replace(/\n/g, '<br>') + '</div></div>'
            + '<div class="stv-grammar-section">'
            + '<div class="stv-grammar-section-title">활용 규칙</div>'
            + '<pre class="stv-grammar-formation">' + escapeHtml(rulesText) + '</pre></div>'
            + '<div class="stv-grammar-section">'
            + '<div class="stv-grammar-section-title">대표 동사</div>'
            + '<div class="stv-grammar-section-body">' + escapeHtml(info.examples) + '</div></div>'
            + (info.tip ? '<div class="stv-grammar-section"><div class="stv-grammar-section-title">팁</div><div class="stv-grammar-section-body">' + escapeHtml(info.tip).replace(/\n/g, '<br>') + '</div></div>' : '')
            + '</div>'
            + '<div class="stv-dialog-footer"><button class="stv-btn stv-btn-cancel stv-grammar-close">닫기</button></div></div>';
    }

    document.body.appendChild(overlay);

    var closeModal = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeModal);
    overlay.querySelector('.stv-grammar-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
}

/**
 * Find the best matching grammar explanation for a label.
 * Tries exact match first, then keyword search.
 * Checks English explanations first for English words, then Japanese.
 */
function findGrammarExplanation(label, language) {
    if (!label) return null;
    var normalized = label.trim().toLowerCase();
    var normalizedOriginal = label.trim();

    // Determine which dictionaries to search and in what order
    var dictionaries = (language === 'en')
        ? [ENGLISH_GRAMMAR_EXPLANATIONS, GRAMMAR_EXPLANATIONS]
        : [GRAMMAR_EXPLANATIONS, ENGLISH_GRAMMAR_EXPLANATIONS];

    for (var d = 0; d < dictionaries.length; d++) {
        var dict = dictionaries[d];
        // Exact match (case-insensitive for English)
        for (var key in dict) {
            if (key === normalizedOriginal || key.toLowerCase() === normalized) {
                var result = Object.assign({}, dict[key]);
                result._matchedKey = key;
                return result;
            }
        }
        // Keyword search
        var keys = Object.keys(dict);
        keys.sort(function (a, b) { return b.length - a.length; });
        for (var i = 0; i < keys.length; i++) {
            if (normalized.includes(keys[i].toLowerCase())) {
                var result2 = Object.assign({}, dict[keys[i]]);
                result2._matchedKey = keys[i];
                return result2;
            }
        }
    }
    return null;
}

/**
 * Show a read-only modal with grammar form explanation.
 */
function showGrammarInfoModal(grammarLabel, language) {
    var existing = document.getElementById('stv-grammar-modal-overlay');
    if (existing) existing.remove();

    var info = findGrammarExplanation(grammarLabel, language);

    var overlay = document.createElement('div');
    overlay.id = 'stv-grammar-modal-overlay';
    overlay.className = 'stv-dialog-overlay';

    if (!info) {
        // No built-in explanation found
        overlay.innerHTML = '<div class="stv-dialog stv-grammar-modal">'
            + '<div class="stv-dialog-header"><h3><span class="fa-solid fa-book-open"></span> 문법 정보</h3>'
            + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
            + '<div class="stv-dialog-body">'
            + '<div class="stv-grammar-label-display">' + escapeHtml(grammarLabel) + '</div>'
            + '<p class="stv-grammar-no-info">이 문법형에 대한 내장 설명이 아직 없습니다.</p>'
            + '</div>'
            + '<div class="stv-dialog-footer">'
            + '<button class="stv-btn stv-btn-cancel" id="stv-grammar-modal-close">닫기</button>'
            + '</div></div>';
    } else {
        // Determine display title: if badge already shows the Korean name, show English key as subtitle
        var displayTitle = info.name;
        if (language === 'en' && grammarLabel === info.name && KOREAN_TO_ENGLISH_GRAMMAR_MAP[grammarLabel]) {
            var enKey = KOREAN_TO_ENGLISH_GRAMMAR_MAP[grammarLabel];
            displayTitle = enKey.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        }
        var bodyHtml = '<div class="stv-grammar-label-display">' + escapeHtml(grammarLabel) + '</div>'
            + '<h4 class="stv-grammar-name">' + escapeHtml(displayTitle) + '</h4>';
        if (info.description) {
            bodyHtml += '<div class="stv-grammar-section">'
                + '<div class="stv-grammar-section-title">설명</div>'
                + '<div class="stv-grammar-section-body">' + escapeHtml(info.description).replace(/\n/g, '<br>') + '</div></div>';
        }
        if (info.formation) {
            bodyHtml += '<div class="stv-grammar-section">'
                + '<div class="stv-grammar-section-title">형성 규칙</div>'
                + '<pre class="stv-grammar-formation">' + escapeHtml(info.formation) + '</pre></div>';
        }
        if (info.usage) {
            bodyHtml += '<div class="stv-grammar-section">'
                + '<div class="stv-grammar-section-title">용례</div>'
                + '<div class="stv-grammar-section-body">' + escapeHtml(info.usage).replace(/\n/g, '<br>') + '</div></div>';
        }

        overlay.innerHTML = '<div class="stv-dialog stv-grammar-modal">'
            + '<div class="stv-dialog-header"><h3><span class="fa-solid fa-book-open"></span> 문법 정보</h3>'
            + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
            + '<div class="stv-dialog-body">' + bodyHtml + '</div>'
            + '<div class="stv-dialog-footer">'
            + '<button class="stv-btn stv-btn-cancel" id="stv-grammar-modal-close">닫기</button>'
            + '</div></div>';
    }

    document.body.appendChild(overlay);

    var closeModal = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.getElementById('stv-grammar-modal-close').addEventListener('click', closeModal);
}

function addVocabWord(data) {
    var settings = getSettings();
    var lang = data.language || detectLanguage(data.word, data.reading);
    var word = {
        id: uid(),
        word: data.word || '',
        reading: normalizeReading(data.reading || '', lang),
        meaning: data.meaning || '',
        partOfSpeech: data.partOfSpeech || '',
        grammarInfo: data.grammarInfo || '',
        verbGroup: data.verbGroup || null,
        jlptLevel: data.jlptLevel || null,
        baseForm: data.baseForm || null,
        kanjiBreakdown: data.kanjiBreakdown || null,
        examples: data.examples || [],
        wordForms: data.wordForms || null,
        language: lang,
        addedAt: new Date().toISOString(),
        source: data.source || 'manual',
    };
    settings.vocabList.push(word);
    saveSettings();
    renderVocabList();
    return word;
}

function updateVocabWord(id, updates) {
    var settings = getSettings();
    var idx = settings.vocabList.findIndex(function (w) { return w.id === id; });
    if (idx === -1) return null;
    // Normalize reading for Japanese words
    if (updates.reading !== undefined) {
        var lang = updates.language || settings.vocabList[idx].language;
        updates.reading = normalizeReading(updates.reading, lang);
    }
    Object.assign(settings.vocabList[idx], updates);
    saveSettings();
    renderVocabList();
    return settings.vocabList[idx];
}

function removeVocabWord(id) {
    var settings = getSettings();
    settings.vocabList = settings.vocabList.filter(function (w) { return w.id !== id; });
    saveSettings();
    renderVocabList();
}

/**
 * Normalize part of speech to match dropdown values.
 * Handles Japanese, English, and various LLM output variations.
 */
function normalizePartOfSpeech(pos) {
    if (!pos) return '';
    var p = pos.trim();
    var POS_MAP = {
        // Korean (already correct)
        '명사': '명사', '동사': '동사', '형용사': '형용사', '부사': '부사',
        '접속사': '접속사', '조사': '조사', '감탄사': '감탄사', '대명사': '대명사',
        '전치사': '전치사', '조동사': '조동사', '연체사': '연체사', '접미사': '접미사', '접두사': '접두사',
        // Japanese
        '名詞': '명사', '動詞': '동사', '形容詞': '형용사', '形容動詞': '형용사',
        'イ形容詞': '형용사', 'ナ形容詞': '형용사', 'い形容詞': '형용사', 'な形容詞': '형용사',
        '副詞': '부사', '接続詞': '접속사', '助詞': '조사', '感動詞': '감탄사', '感嘆詞': '감탄사',
        '代名詞': '대명사', '助動詞': '조동사', '連体詞': '연체사', '接尾辞': '접미사', '接頭辞': '접두사',
        // English
        'noun': '명사', 'verb': '동사', 'adjective': '형용사', 'adverb': '부사',
        'conjunction': '접속사', 'particle': '조사', 'interjection': '감탄사',
        'pronoun': '대명사', 'preposition': '전치사', 'auxiliary verb': '조동사',
        'determiner': '연체사', 'suffix': '접미사', 'prefix': '접두사',
        // Common variations
        'adj': '형용사', 'adv': '부사', 'n': '명사', 'v': '동사',
        'na-adjective': '형용사', 'i-adjective': '형용사',
        'na adjective': '형용사', 'i adjective': '형용사',
    };
    // Exact match
    if (POS_MAP[p]) return POS_MAP[p];
    // Case-insensitive match
    var lower = p.toLowerCase();
    for (var key in POS_MAP) {
        if (key.toLowerCase() === lower) return POS_MAP[key];
    }
    // Partial match: check if any key is contained in the value
    for (var key2 in POS_MAP) {
        if (p.includes(key2) || lower.includes(key2.toLowerCase())) return POS_MAP[key2];
    }
    return p; // Return as-is if no match
}

/**
 * Use LLM to analyze a word — independent API, no chat lock
 */
async function analyzeWordWithLLM(word, langOverride, contextSentence) {
    var lang = (langOverride && langOverride !== 'auto') ? langOverride : detectLanguage(word);
    var langNames = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English', other: '', unknown: '' };

    var prompt = 'You are a professional linguist and language teaching expert who explains vocabulary to Korean-speaking learners at a beginner-to-intermediate level. '
        + 'Analyze the following ' + (langNames[lang] || '') + ' word and return detailed information.\n\n'
        + (contextSentence ? 'CONTEXT SENTENCE (use this to determine the exact grammatical role of the word):\n"' + contextSentence + '"\n\n' : '')
        + 'Return ONLY a valid JSON object with these fields:\n'
        + '- "reading": pronunciation. If the word has MULTIPLE readings, separate them with ", " (e.g. "にっき, にき" for 日記). Japanese→hiragana, English→IPA, Chinese→pinyin, Korean→skip.\n'
        + '- "meaning": meaning in Korean. Use dictionary-style numbered format ONLY listing the meanings, no explanations or descriptions. Format: "1. 뜻1\n2. 뜻2\n3. 뜻3". Example for 掛ける: "1. 걸다\n2. 앉다\n3. (전화를) 걸다\n4. (시간, 돈 등을) 들이다\n5. 쓰다, 착용하다". Always use this numbered short-meaning format without verbose explanations.\n'
        + '- "partOfSpeech": MUST be EXACTLY one of these Korean values: 명사, 동사, 형용사, 부사, 접속사, 조사, 감탄사, 대명사, 전치사, 조동사, 연체사, 접미사, 접두사, 기타\n'
        + '  → For Japanese: 名詞→명사, 動詞→동사, イ形容詞/形容詞→형용사, ナ形容詞/形容動詞→형용사, 副詞→부사, 接続詞→접속사, 助詞→조사, 助動詞→조동사, 連体詞→연체사, 感動詞→감탄사\n'
        + '- "grammarInfo": If the word is a conjugated/inflected form (not dictionary form), provide a SHORT and CONCISE conjugation label. MUST be brief — max ~15 characters. Do NOT include the original word, quotes, or full grammatical breakdowns.\n'
        + '  IMPORTANT: If a CONTEXT SENTENCE is provided above, determine the grammatical role from that sentence. For example, regular English past tense and past participle are often the same form (e.g. "walked"), but "I walked" is 과거형, while "I have walked" or "was walked" is 과거 분사. Use the context to pick the correct one. If BOTH roles apply or no context is given, list both separated by " / " (e.g. "과거형 / 과거 분사").\n'
        + '  → For Japanese: Use SHORT form names ONLY. Examples: "て형", "た형 (과거)", "ます형", "ない형 (부정)", "수동형", "사역형", "가능형", "ば형 (가정)", "의향형", "명령형", "금지형 (な)", "なら형", "미연형 + ず", "연용형". For combined: "사역수동 + た형". NEVER write full sentences like 「動詞「X」の未然形 + 助動詞「ず」」.\n'
        + '  → For Korean: e.g. "과거형", "진행형", "피동형", "사동형", "연결 -아서", "관형사형", "명사형 -기"\n'
        + '  → For English: e.g. "과거형", "과거 분사", "-ing형", "비교급", "최상급", "복수형", "3인칭 단수"\n'
        + '  → Empty string "" if the word is already in its dictionary/base form.\n'
        + '- "baseForm": If the word is a conjugated/inflected form, return its dictionary/base form (원형). E.g. 介さず→"介する", 食べた→"食べる", ran→"run", 먹었다→"먹다". Return null if already in base form.\n'
        + '- "examples": array of 2 objects, each with "sentence" (example sentence in original language)' + (lang === 'ko' ? '. Since this is a Korean word, do NOT include "translation" field — Korean examples need no translation.\n' : ' and "translation" (Korean translation of that sentence)\n')
        + '- "wordForms": an object listing ALL inflected/derived forms of this word, grouped by part of speech. Each key is a part-of-speech label in Korean (e.g. "동사형", "명사형", "형용사형"), and the value is an array of objects with "label" (form description in Korean) and "word" (the actual form). IMPORTANT: "word" must contain ONLY the word itself, without any reading/pronunciation in parentheses. Correct: "食べて". Wrong: "食べて (たべて)".\n'
        + '  → Example for English "do": {"동사형":[{"label":"3인칭 단수 현재","word":"does"},{"label":"과거형","word":"did"},{"label":"과거 분사","word":"done"},{"label":"현재 분사","word":"doing"}],"명사형":[{"label":"복수형","word":"dos"}]}\n'
        + '  → Example for Japanese "食べる": {"동사형":[{"label":"て형","word":"食べて"},{"label":"た형","word":"食べた"},{"label":"ない형","word":"食べない"},{"label":"ます형","word":"食べます"},{"label":"수동형","word":"食べられる"},{"label":"사역형","word":"食べさせる"},{"label":"가능형","word":"食べられる"},{"label":"의향형","word":"食べよう"},{"label":"가정형","word":"食べれば"},{"label":"명령형","word":"食べろ"},{"label":"금지형","word":"食べるな"}]}\n'
        + '  → For Japanese verbs, ALSO include the 연용형 (continuative/stem form) used as a noun if it is commonly used. Add it under "명사형" group with label "연용형/명사". Examples: 空く→空き, 休む→休み, 動く→動き, 始まる→始まり, 終わる→終わり, 遊ぶ→遊び, 流れる→流れ, 話す→話, 光る→光\n'
        + '  → Example for Korean "먹다": {"동사형":[{"label":"과거형","word":"먹었다"},{"label":"현재 진행","word":"먹고 있다"},{"label":"연결형 -아/어","word":"먹어"},{"label":"관형사형","word":"먹는/먹은/먹을"}]}\n'
        + '  → Include forms for ALL parts of speech the word can serve as. If the word is ONLY used as one part of speech, include just that one group.\n'
        + '  → If the word is already a conjugated form, show forms based on its dictionary/base form.\n'
        + '- "verbGroup": (Japanese verbs only) verb conjugation group. MUST be EXACTLY one of: "五段", "一段", "サ変", "カ変". Return null if the word is not a Japanese verb.\n'
        + '- "jlptLevel": (Japanese words only) estimated JLPT level. MUST be EXACTLY one of: "N5", "N4", "N3", "N2", "N1". Return null if not Japanese or if the word is outside JLPT scope.\n'
        + '- "kanjiBreakdown": (Japanese words containing kanji only) array of kanji characters in the word with their individual info. Format: [{"kanji":"代","meaning":"대신할 대","onyomi":"ダイ, タイ","kunyomi":"か(わる), か(える)"}]. Return null if the word has no kanji.\n\n'
        + 'Example format for "examples": [{"sentence":"彼は毎日走る。","translation":"그는 매일 달린다."},{"sentence":"公園で走るのが好きだ。","translation":"공원에서 달리는 것을 좋아한다."}]\n\n'
        + 'Return ONLY the JSON object, no other text.\n\n'
        + 'Word: ' + word + '\n\nJSON:';

    try {
        var resp = await callLLM(prompt);
        if (!resp || typeof resp !== 'string') {
            console.warn('[' + MODULE_NAME + '] analyzeWord: empty or invalid LLM response for "' + word + '"');
            return null;
        }
        var match = resp.match(/\{[\s\S]*\}/);
        if (!match) {
            console.warn('[' + MODULE_NAME + '] analyzeWord: no JSON found in response for "' + word + '"');
            return null;
        }
        // Sanitize control characters that break JSON.parse
        // 1. Remove truly invalid control chars
        var jsonStr = match[0].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        // 2. Escape literal newlines/tabs inside JSON string values
        jsonStr = jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, function (m) {
            return m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
        });
        var result = JSON.parse(jsonStr);
        // Normalize part of speech
        if (result.partOfSpeech) {
            result.partOfSpeech = normalizePartOfSpeech(result.partOfSpeech);
        }
        // Normalize examples to [{sentence, translation}] format
        if (result.examples && Array.isArray(result.examples)) {
            result.examples = result.examples.map(function (ex) {
                if (typeof ex === 'string') return { sentence: ex, translation: '' };
                if (ex && typeof ex === 'object') return { sentence: ex.sentence || '', translation: ex.translation || '' };
                return { sentence: String(ex), translation: '' };
            });
        }
        // Clean wordForms: strip parenthetical readings from word fields
        if (result.wordForms && typeof result.wordForms === 'object') {
            Object.keys(result.wordForms).forEach(function (groupKey) {
                var forms = result.wordForms[groupKey];
                if (Array.isArray(forms)) {
                    forms.forEach(function (form) {
                        if (form.word && typeof form.word === 'string') {
                            // Remove readings like "(あく)" or "（あく）" or " (あく)"
                            form.word = form.word.replace(/\s*[\(\uff08][^\)\uff09]*[\)\uff09]\s*$/, '').trim();
                        }
                    });
                }
            });
        }
        return result;
    } catch (e) {
        console.error('[' + MODULE_NAME + '] analyzeWord error for "' + word + '":', e && e.message ? e.message : e, e);
        return null;
    }
}

/**
 * Use LLM to generate additional example sentences for a word.
 * Returns array of {sentence, translation} objects.
 */
async function generateExamplesWithLLM(word, existingExamples, langOverride) {
    var lang = (langOverride && langOverride !== 'auto') ? langOverride : detectLanguage(word);
    var langNames = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English', other: '', unknown: '' };

    var existingText = '';
    if (existingExamples && existingExamples.length > 0) {
        existingText = '\n\nAlready existing examples (do NOT repeat these):\n';
        existingExamples.forEach(function (ex) {
            var s = (typeof ex === 'string') ? ex : (ex.sentence || '');
            if (s) existingText += '- ' + s + '\n';
        });
    }

    var isKorean = lang === 'ko';
    var prompt = 'You are a professional language teaching expert. Generate 3 NEW example sentences using the ' + (langNames[lang] || '') + ' word "' + word + '".\n\n'
        + 'Rules:\n'
        + '- Sentences should be natural and useful for language learners\n'
        + '- Use different grammar patterns and contexts for each sentence\n'
        + (isKorean ? '- Sentences should be in Korean. Do NOT include translations.\n' : '- Include Korean translation for each sentence\n')
        + existingText + '\n'
        + (isKorean
            ? 'Return ONLY a valid JSON array of objects with "sentence" field.\nExample: [{"sentence":"..."},{"sentence":"..."},{"sentence":"..."}]\n\n'
            : 'Return ONLY a valid JSON array of objects with "sentence" and "translation" fields.\nExample: [{"sentence":"...","translation":"..."},{"sentence":"...","translation":"..."},{"sentence":"...","translation":"..."}]\n\n')
        + 'JSON:';

    try {
        var resp = await callLLM(prompt);
        var match = resp.match(/\[[\s\S]*?\]/);
        if (!match) return [];
        var results = JSON.parse(match[0]);
        return results.filter(function (r) {
            return r && r.sentence;
        }).map(function (r) {
            return { sentence: r.sentence || '', translation: r.translation || '' };
        });
    } catch (e) {
        console.error('[' + MODULE_NAME + '] generateExamples error:', e);
        return [];
    }
}

/**
 * Use LLM to detect the dictionary/base form of a word.
 * Returns the base form string if different from the word, or null.
 */
async function detectBaseForm(word, langOverride) {
    var lang = (langOverride && langOverride !== 'auto') ? langOverride : detectLanguage(word);
    var langNames = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English', other: '', unknown: '' };

    var prompt = 'You are a professional linguist specializing in morphological analysis. Given the following ' + (langNames[lang] || '') + ' word, determine if it is already in its dictionary/base form (원형/辞書形).\n\n'
        + 'Rules:\n'
        + '- For Japanese:\n'
        + '  • Verbs: ANY conjugated form → dictionary form (e.g. 食べた→食べる, 走って→走る, にして→にする, 話せば→話す, 書かない→書く, 見られる→見る, させる→する)\n'
        + '  • て형/た형/ます형/ない형/ば형/수동형/사역형/가능형/의향형/명령형 → ALL are NOT base form\n'
        + '  • 연용형 (continuative form) used as noun: these are derived nouns from verbs. Return the verb dictionary form.\n'
        + '    Examples: 空き(あき)→空く(あく), 休み(やすみ)→休む(やすむ), 始まり(はじまり)→始まる(はじまる), 終わり(おわり)→終わる(おわる), 動き(うごき)→動く(うごく), 遊び(あそび)→遊ぶ(あそぶ)\n'
        + '    HOWEVER: If the noun form is the PRIMARY/most common usage and rarely used as a verb in modern Japanese (e.g. 話=story is primarily a noun), return null.\n'
        + '  • Compound verbs with particles: にして→にする, として→とする, について→につく or について(as grammar point→null)\n'
        + '  • i-adjectives: 美しかった→美しい, 大きくて→大きい, 良くない→良い\n'
        + '  • na-adjectives: 静かだった→静かだ, きれいで→きれいだ\n'
        + '  • If a word looks like a conjugated verb form, ALWAYS return the dictionary form\n'
        + '- For Korean:\n'
        + '  • Verbs/adjectives: ANY conjugated form → base form ending in -다 (e.g. 먹었다→먹다, 예뻤어→예쁘다, 하고→하다, 갔으면→가다, 봤는데→보다, 살았던→살다, 만들어서→만들다)\n'
        + '  • 연결어미/종결어미/관형사형/명사형 → ALL are NOT base form\n'
        + '  • -아/어/여, -고, -며, -면, -(으)니, -(으)ㄹ, -는, -(으)ㄴ, -기, -ㅁ endings → conjugated, return base form\n'
        + '- For English:\n'
        + '  • Past tense → base (e.g. ran→run, went→go, studied→study, was/were→be, had→have)\n'
        + '  • Present participle / gerund → base (e.g. running→run, studying→study, being→be)\n'
        + '  • Past participle → base (e.g. written→write, gone→go, been→be, eaten→eat)\n'
        + '  • Third person singular → base (e.g. goes→go, studies→study, has→have)\n'
        + '  • Comparative/superlative → base (e.g. better→good, worst→bad, bigger→big, most→much)\n'
        + '  • Plural → singular ONLY for irregular plurals (e.g. children→child, mice→mouse, teeth→tooth)\n'
        + '- For Chinese: usually already base form, return null\n'
        + '- If the word IS already the dictionary/base form, return null\n'
        + '- When in doubt, assume it IS conjugated and return the base form\n\n'
        + 'Return ONLY a valid JSON object: {"baseForm": "원형단어"} or {"baseForm": null}\n'
        + 'No other text.\n\n'
        + 'Word: ' + word + '\n\nJSON:';

    try {
        var resp = await callLLM(prompt);
        var match = resp.match(/\{[\s\S]*\}/);
        if (!match) return null;
        var result = JSON.parse(match[0]);
        if (result.baseForm && result.baseForm !== word && result.baseForm.trim()) {
            return result.baseForm.trim();
        }
        return null;
    } catch (e) {
        console.error('[' + MODULE_NAME + '] detectBaseForm error:', e);
        return null;
    }
}

/**
 * Show a snackbar at the bottom to suggest adding the base form.
 */
function showBaseFormSnackbar(originalWord, baseForm) {
    // Remove any existing snackbar
    var old = document.getElementById('stv-snackbar');
    if (old) {
        try { old.hidePopover(); } catch (e) { }
        old.remove();
    }

    var existing = getVocab().find(function (w) { return w.word === baseForm; });
    if (existing) return; // base form already in vocab

    var snackbar = document.createElement('div');
    snackbar.id = 'stv-snackbar';
    snackbar.className = 'stv-snackbar';
    snackbar.setAttribute('popover', 'manual');
    snackbar.innerHTML = '<span class="stv-snackbar-text">'
        + '<span class="fa-solid fa-lightbulb stv-snackbar-icon"></span> '
        + '"<b>' + escapeHtml(originalWord) + '</b>"의 원형 "<b>' + escapeHtml(baseForm) + '</b>"도 추가할까요?'
        + '</span>'
        + '<div class="stv-snackbar-actions">'
        + '<button class="stv-snackbar-btn stv-snackbar-yes">추가</button>'
        + '<button class="stv-snackbar-btn stv-snackbar-no">닫기</button>'
        + '</div>';
    document.body.appendChild(snackbar);
    snackbar.showPopover();
    // Double rAF ensures the initial hidden state is painted before showing
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            snackbar.classList.add('stv-snackbar-show');
        });
    });

    var autoHide = setTimeout(function () { dismissSnackbar(); }, 15000);

    function dismissSnackbar() {
        clearTimeout(autoHide);
        snackbar.classList.remove('stv-snackbar-show');
        snackbar.classList.add('stv-snackbar-hide');
        setTimeout(function () {
            try { snackbar.hidePopover(); } catch (e) { }
            snackbar.remove();
        }, 300);
    }

    snackbar.querySelector('.stv-snackbar-no').addEventListener('click', function () {
        dismissSnackbar();
    });

    snackbar.querySelector('.stv-snackbar-yes').addEventListener('click', async function () {
        dismissSnackbar();
        // Open the word dialog prefilled with the base form (no auto-analyze)
        await showWordDialog(null, { initWord: baseForm });
    });
}

function exportVocab() {
    var vocab = getVocab();
    if (vocab.length === 0) { toastr.info('내보낼 단어가 없습니다.'); return; }
    showExportDialog(vocab);
}

function showExportDialog(vocab) {
    var existing = document.getElementById('stv-export-overlay');
    if (existing) existing.remove();

    // Count words per language for display
    var langCounts = {};
    vocab.forEach(function (w) {
        var l = w.language || 'unknown';
        langCounts[l] = (langCounts[l] || 0) + 1;
    });
    var langLabelsMap = { ja: '日本語', en: 'English', ko: '한국어', zh: '中文', other: '기타', unknown: '기타' };
    var langFilterHtml = '<option value="" selected>전체 (' + vocab.length + ')</option>';
    Object.keys(langCounts).forEach(function (l) {
        langFilterHtml += '<option value="' + l + '">' + (langLabelsMap[l] || l) + ' (' + langCounts[l] + ')</option>';
    });

    // Compute date range from vocab
    var dates = vocab.map(function (w) { return w.addedAt ? w.addedAt.slice(0, 10) : ''; }).filter(Boolean);
    var minDate = dates.length > 0 ? dates.reduce(function (a, b) { return a < b ? a : b; }) : '';
    var maxDate = dates.length > 0 ? dates.reduce(function (a, b) { return a > b ? a : b; }) : '';
    var today = new Date().toISOString().slice(0, 10);

    var overlay = document.createElement('div');
    overlay.id = 'stv-export-overlay';
    overlay.className = 'stv-dialog-overlay';
    overlay.innerHTML = '<div class="stv-dialog stv-export-dialog">'
        + '<div class="stv-dialog-header"><h3>내보내기</h3>'
        + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
        + '<div class="stv-dialog-body">'
        + '<div class="stv-field"><label>언어</label>'
        + '<select id="stv-export-lang-filter">' + langFilterHtml + '</select></div>'
        + '<div class="stv-field"><label>날짜 범위</label>'
        + '<select id="stv-export-date-mode">'
        + '<option value="all" selected>전체</option>'
        + '<option value="single">특정 날짜</option>'
        + '<option value="range">날짜 범위</option>'
        + '</select></div>'
        + '<div id="stv-export-date-inputs" class="stv-export-date-inputs" style="display:none;">'
        + '<input type="date" id="stv-export-date-from" value="' + (minDate || today) + '" />'
        + '<span id="stv-export-date-sep" class="stv-export-date-sep" style="display:none;">~</span>'
        + '<input type="date" id="stv-export-date-to" value="' + (maxDate || today) + '" style="display:none;" />'
        + '</div>'
        + '<p id="stv-export-count" class="stv-export-count-text">' + vocab.length + '개 단어</p>'
        + '<div class="stv-export-options">'
        + '<button class="stv-btn stv-export-btn" data-format="json"><span class="fa-solid fa-file-code"></span> JSON</button>'
        + '<button class="stv-btn stv-export-btn" data-format="txt"><span class="fa-solid fa-file-lines"></span> TXT</button>'
        + '<button class="stv-btn stv-export-btn" data-format="pdf"><span class="fa-solid fa-file-pdf"></span> PDF</button>'
        + '</div></div></div>';
    document.body.appendChild(overlay);

    var closeExport = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeExport);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeExport(); });

    // Helpers
    function getFilteredVocab() {
        var langVal = document.getElementById('stv-export-lang-filter').value;
        var dateMode = document.getElementById('stv-export-date-mode').value;
        var filtered = langVal ? vocab.filter(function (w) { return w.language === langVal; }) : vocab.slice();
        if (dateMode === 'single') {
            var dateVal = document.getElementById('stv-export-date-from').value;
            if (dateVal) {
                filtered = filtered.filter(function (w) { return w.addedAt && w.addedAt.slice(0, 10) === dateVal; });
            }
        } else if (dateMode === 'range') {
            var from = document.getElementById('stv-export-date-from').value;
            var to = document.getElementById('stv-export-date-to').value;
            if (from) filtered = filtered.filter(function (w) { return w.addedAt && w.addedAt.slice(0, 10) >= from; });
            if (to) filtered = filtered.filter(function (w) { return w.addedAt && w.addedAt.slice(0, 10) <= to; });
        }
        return filtered;
    }

    function updateCount() {
        document.getElementById('stv-export-count').textContent = getFilteredVocab().length + '개 단어';
    }

    // Date mode toggle
    document.getElementById('stv-export-date-mode').addEventListener('change', function () {
        var mode = this.value;
        var inputs = document.getElementById('stv-export-date-inputs');
        var sep = document.getElementById('stv-export-date-sep');
        var fromInput = document.getElementById('stv-export-date-from');
        var toInput = document.getElementById('stv-export-date-to');
        if (mode === 'all') {
            inputs.style.display = 'none';
        } else if (mode === 'single') {
            inputs.style.display = 'flex';
            sep.style.display = 'none';
            toInput.style.display = 'none';
            // Auto-open date picker
            setTimeout(function () { try { fromInput.showPicker(); } catch (_) { fromInput.focus(); } }, 100);
        } else {
            inputs.style.display = 'flex';
            sep.style.display = '';
            toInput.style.display = '';
            // Auto-open date picker for start date
            setTimeout(function () { try { fromInput.showPicker(); } catch (_) { fromInput.focus(); } }, 100);
        }
        updateCount();
    });

    // Update count on filter changes
    document.getElementById('stv-export-lang-filter').addEventListener('change', updateCount);
    document.getElementById('stv-export-date-from').addEventListener('change', function () {
        updateCount();
        // In range mode, auto-open the end date picker after selecting start date
        var mode = document.getElementById('stv-export-date-mode').value;
        if (mode === 'range') {
            var toInput = document.getElementById('stv-export-date-to');
            setTimeout(function () { try { toInput.showPicker(); } catch (_) { toInput.focus(); } }, 100);
        }
    });
    document.getElementById('stv-export-date-to').addEventListener('change', updateCount);

    overlay.querySelectorAll('.stv-export-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var format = btn.dataset.format;
            var filtered = getFilteredVocab();
            if (filtered.length === 0) { toastr.warning('내보낼 단어가 없습니다.'); return; }
            closeExport();
            if (format === 'json') exportVocabJSON(filtered);
            else if (format === 'txt') exportVocabTXT(filtered);
            else if (format === 'pdf') exportVocabPDF(filtered);
        });
    });
}

function exportVocabJSON(vocab) {
    var blob = new Blob([JSON.stringify(vocab, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'st-vocabulary_' + dateStamp() + '.json');
    toastr.success(vocab.length + '개 단어 JSON 내보내기 완료');
}

function exportVocabTXT(vocab) {
    var lines = [];
    lines.push('ST-Vocabulary 단어장');
    lines.push('내보내기 날짜: ' + new Date().toLocaleString('ko-KR'));
    lines.push('총 단어 수: ' + vocab.length);
    lines.push('━'.repeat(40));
    lines.push('');
    vocab.forEach(function (w, idx) {
        lines.push((idx + 1) + '. ' + w.word + (w.reading ? '  [' + w.reading + ']' : ''));
        if (w.partOfSpeech) lines.push('   품사: ' + w.partOfSpeech);
        if (w.grammarInfo) lines.push('   문법: ' + w.grammarInfo);
        if (w.meaning) lines.push('   뜻: ' + w.meaning);
        if (w.examples && w.examples.length > 0) {
            lines.push('   예문:');
            w.examples.forEach(function (ex) {
                var sentence = getExampleSentence(ex);
                var translation = getExampleTranslation(ex);
                lines.push('     • ' + sentence);
                if (translation) lines.push('       → ' + translation);
            });
        }
        lines.push('   추가일: ' + formatDate(w.addedAt));
        lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'st-vocabulary_' + dateStamp() + '.txt');
    toastr.success(vocab.length + '개 단어 TXT 내보내기 완료');
}

function exportVocabPDF(vocab) {
    var langLabels = { ja: '日本語', en: 'English', ko: '한국어', zh: '中文', other: '기타' };
    var html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">'
        + '<title>ST-Vocabulary</title>'
        + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-jp-dynamic-subset.min.css">'
        + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">'
        + '<style>'
        + "body{font-family:'Pretendard JP Variable','Pretendard Variable','Pretendard JP','Pretendard',-apple-system,BlinkMacSystemFont,system-ui,'Noto Sans KR','Malgun Gothic',sans-serif;margin:30px 40px;color:#222;font-size:12px;line-height:1.5;}"
        + '.subtitle{text-align:center;color:#888;font-size:11px;margin-bottom:20px;}'
        + 'table{width:100%;border-collapse:collapse;page-break-inside:auto;}'
        + 'thead{display:table-header-group;}'
        + 'tr{page-break-inside:avoid;page-break-after:auto;}'
        + 'th{background:#333;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.3px;}'
        + 'td{padding:7px 8px;border-bottom:1px solid #ccc;vertical-align:top;font-size:12px;}'
        + '.word{font-size:19px;font-weight:bold;}'
        + '.reading{color:#555;font-size:11px;}'
        + '.tags{margin-top:2px;font-size:9.5px;color:#666;}'
        + '.tags span{margin-right:3px;}'
        + '.tag-sep{color:#ccc;}'
        + '.baseform{font-size:10.5px;color:#666;margin-top:2px;}'
        + '.meaning{white-space:pre-line;}'
        + '.kanji-row{font-size:10.5px;color:#555;margin-top:4px;padding-top:3px;border-top:1px dashed #ddd;}'
        + '.kanji-entry{margin-bottom:1px;}'
        + '.kanji-char{font-weight:500;font-size:13px;}'
        + '.example-item{margin-bottom:3px;padding-left:6px;border-left:2px solid #ccc;}'
        + '.example-trans{color:#777;font-size:10.5px;font-style:italic;}'
        + '.wf-group-name{font-size:9.5px;color:#888;font-weight:600;margin-top:3px;}'
        + '.wf-group-name:first-child{margin-top:0;}'
        + '.wf-item{font-size:11px;display:inline;white-space:nowrap;}'
        + '.wf-label{color:#888;font-size:9.5px;}'
        + '.wf-sep{color:#ccc;margin:0 2px;}'
        + '@media print{body{margin:15px 20px;}@page{margin:12mm;}th{background:#333!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}'
        + '</style></head><body>'
        + '<div class="subtitle">' + new Date().toLocaleDateString('ko-KR') + ' | ' + vocab.length + '개 단어</div>'
        + '<table><thead><tr>'
        + '<th style="width:3%">#</th>'
        + '<th style="width:18%">단어</th>'
        + '<th style="width:22%">뜻</th>'
        + '<th style="width:30%">예문</th>'
        + '<th style="width:27%">활용형</th>'
        + '</tr></thead><tbody>';

    vocab.forEach(function (w, idx) {
        // Tags (partOfSpeech, lang, grammar, jlpt, verbGroup)
        var tags = [];
        if (w.partOfSpeech) tags.push(escapeHtml(w.partOfSpeech));
        tags.push(langLabels[w.language] || w.language || '');
        if (w.grammarInfo) tags.push(escapeHtml(w.grammarInfo));
        if (w.jlptLevel) tags.push(escapeHtml(w.jlptLevel));
        if (w.verbGroup) tags.push(escapeHtml(w.verbGroup));
        var tagsHtml = '<div class="tags">' + tags.map(function (t, i) {
            return '<span>' + t + '</span>' + (i < tags.length - 1 ? '<span class="tag-sep">|</span>' : '');
        }).join('') + '</div>';

        // Base form
        var baseHtml = w.baseForm ? '<div class="baseform">원형: ' + escapeHtml(w.baseForm) + '</div>' : '';

        // Kanji breakdown
        var kanjiHtml = '';
        if (w.kanjiBreakdown && Array.isArray(w.kanjiBreakdown) && w.kanjiBreakdown.length > 0) {
            kanjiHtml = '<div class="kanji-row">';
            w.kanjiBreakdown.forEach(function (k) {
                var info = escapeHtml(k.meaning || '');
                if (k.onyomi) info += ' (' + escapeHtml(k.onyomi);
                if (k.kunyomi) info += (k.onyomi ? ' / ' : ' (') + escapeHtml(k.kunyomi);
                if (k.onyomi || k.kunyomi) info += ')';
                kanjiHtml += '<div class="kanji-entry"><span class="kanji-char">' + escapeHtml(k.kanji || '') + '</span> ' + info + '</div>';
            });
            kanjiHtml += '</div>';
        }

        // Examples
        var exHtml = '';
        if (w.examples && w.examples.length > 0) {
            w.examples.forEach(function (ex) {
                var s = getExampleSentence(ex);
                var t = getExampleTranslation(ex);
                exHtml += '<div class="example-item">' + escapeHtml(s);
                if (t) exHtml += '<div class="example-trans">\u2192 ' + escapeHtml(t) + '</div>';
                exHtml += '</div>';
            });
        }

        // Word forms
        var wfHtml = '';
        if (w.wordForms && typeof w.wordForms === 'object') {
            var groups = Object.keys(w.wordForms);
            groups.forEach(function (groupLabel) {
                var forms = w.wordForms[groupLabel];
                if (!Array.isArray(forms) || forms.length === 0) return;
                wfHtml += '<div class="wf-group-name">' + escapeHtml(groupLabel) + '</div>';
                forms.forEach(function (form, fi) {
                    wfHtml += '<span class="wf-item"><span class="wf-label">' + escapeHtml(form.label || '') + '</span> ' + escapeHtml(form.word || '') + '</span>';
                    if (fi < forms.length - 1) wfHtml += '<span class="wf-sep">|</span>';
                });
            });
        }

        html += '<tr>'
            + '<td>' + (idx + 1) + '</td>'
            + '<td><span class="word">' + escapeHtml(w.word) + '</span>'
            + (w.reading ? '<br><span class="reading">[' + escapeHtml(w.reading) + ']</span>' : '')
            + tagsHtml + baseHtml + kanjiHtml + '</td>'
            + '<td class="meaning">' + escapeHtml(w.meaning || '').replace(/\n/g, '<br>') + '</td>'
            + '<td>' + exHtml + '</td>'
            + '<td>' + wfHtml + '</td>'
            + '</tr>';
    });

    html += '</tbody></table></body></html>';

    var win = window.open('', '_blank');
    if (!win) { toastr.error('팝업이 차단되었습니다. 팝업을 허용해 주세요.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(function () {
        win.print();
    }, 500);
    toastr.success('PDF 인쇄 대화상자가 열립니다. "PDF로 저장"을 선택하세요.');
}

function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

function importVocab() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async function (e) {
        var file = e.target.files[0];
        if (!file) return;
        try {
            var text = await file.text();
            var imported = JSON.parse(text);
            if (!Array.isArray(imported)) throw new Error('올바른 형식이 아닙니다.');
            var settings = getSettings();
            var existing = new Set(settings.vocabList.map(function (w) { return w.word + '|' + w.language; }));
            var added = 0;
            for (var i = 0; i < imported.length; i++) {
                var w = imported[i];
                var key = w.word + '|' + (w.language || detectLanguage(w.word, w.reading));
                if (!existing.has(key)) {
                    w.id = w.id || uid();
                    w.language = w.language || detectLanguage(w.word, w.reading);
                    w.addedAt = w.addedAt || new Date().toISOString();
                    settings.vocabList.push(w);
                    existing.add(key);
                    added++;
                }
            }
            saveSettings();
            renderVocabList();
            toastr.success(added + '개 단어 가져오기 완료');
        } catch (err) {
            toastr.error('가져오기 실패: ' + err.message);
        }
    };
    input.click();
}

// ══════════════════════════════════════════════════════
//  UI MODULE
// ══════════════════════════════════════════════════════

var vocabPanelOpen = false;
var multiSelectMode = false;
var selectedWordIds = new Set();

// ── Vocabulary Panel (Sidebar) ────────────────────────

function createVocabPanel() {
    if (document.getElementById('stv-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'stv-panel';
    panel.className = 'stv-panel';
    panel.innerHTML = '<div class="stv-panel-header">'
        + '<h3><span class="fa-solid fa-book-open"></span> 단어장</h3>'
        + '<div class="stv-panel-actions">'
        + '<button class="stv-btn stv-btn-icon" id="stv-btn-multiselect" title="다중 선택"><span class="fa-solid fa-check-double"></span></button>'
        + '<button class="stv-btn stv-btn-icon" id="stv-btn-add" title="단어 추가"><span class="fa-solid fa-plus"></span></button>'
        + '<button class="stv-btn stv-btn-icon" id="stv-btn-export" title="내보내기"><span class="fa-solid fa-file-export"></span></button>'
        + '<button class="stv-btn stv-btn-icon" id="stv-btn-import" title="가져오기"><span class="fa-solid fa-file-import"></span></button>'
        + '<button class="stv-btn stv-btn-icon" id="stv-btn-close" title="닫기"><span class="fa-solid fa-xmark"></span></button>'
        + '</div></div>'
        + '<div id="stv-multi-actions" class="stv-multi-select-actions" style="display:none;">'
        + '<span class="stv-select-count" id="stv-select-count">0개 선택</span>'
        + '<div class="stv-multi-btns">'
        + '<button class="stv-btn-sm-text" id="stv-select-all">전체</button>'
        + '<button class="stv-btn-sm-text" id="stv-deselect-all">해제</button>'
        + '<button class="stv-btn-sm-text stv-btn-delete-selected" id="stv-delete-selected">'
        + '<span class="fa-solid fa-trash"></span> 삭제</button>'
        + '</div></div>'
        + '<div class="stv-search-bar"><span class="fa-solid fa-magnifying-glass stv-search-icon"></span><input type="text" id="stv-search" placeholder="단어 검색" /></div>'
        + '<div class="stv-filter-bar">'
        + '<select id="stv-filter-lang">'
        + '<option value="">전체 언어</option>'
        + '<option value="ja">日本語</option>'
        + '<option value="en">English</option>'
        + '<option value="ko">한국어</option>'
        + '<option value="zh">中文</option>'
        + '<option value="other">기타</option>'
        + '</select>'
        + '<select id="stv-filter-pos">'
        + '<option value="">전체 품사</option>'
        + '<option value="명사">명사</option>'
        + '<option value="동사">동사</option>'
        + '<option value="형용사">형용사</option>'
        + '<option value="부사">부사</option>'
        + '<option value="접속사">접속사</option>'
        + '<option value="조사">조사</option>'
        + '<option value="감탄사">감탄사</option>'
        + '<option value="대명사">대명사</option>'
        + '<option value="전치사">전치사</option>'
        + '<option value="조동사">조동사</option>'
        + '<option value="연체사">연체사</option>'
        + '<option value="접미사">접미사</option>'
        + '<option value="접두사">접두사</option>'
        + '<option value="기타">기타</option>'
        + '</select>'
        + '<select id="stv-filter-jlpt">'
        + '<option value="">JLPT</option>'
        + '<option value="N5">N5</option>'
        + '<option value="N4">N4</option>'
        + '<option value="N3">N3</option>'
        + '<option value="N2">N2</option>'
        + '<option value="N1">N1</option>'
        + '</select></div>'
        + '<div class="stv-stats"><span id="stv-word-count">0</span>개 단어</div>'
        + '<div id="stv-word-list" class="stv-word-list"></div>';
    document.body.appendChild(panel);

    var backdrop = document.createElement('div');
    backdrop.id = 'stv-backdrop';
    backdrop.className = 'stv-backdrop';
    document.body.appendChild(backdrop);

    document.getElementById('stv-btn-close').addEventListener('click', function () {
        exitMultiSelectMode();
        toggleVocabPanel();
    });
    document.getElementById('stv-btn-add').addEventListener('click', function () { showWordDialog(); });
    document.getElementById('stv-btn-export').addEventListener('click', exportVocab);
    document.getElementById('stv-btn-import').addEventListener('click', importVocab);
    document.getElementById('stv-search').addEventListener('input', function () { renderVocabList(); });
    document.getElementById('stv-filter-lang').addEventListener('change', function () {
        var jlptSel = document.getElementById('stv-filter-jlpt');
        if (jlptSel) {
            var lang = this.value;
            var shouldDisable = lang !== '' && lang !== 'ja';
            jlptSel.disabled = shouldDisable;
            if (shouldDisable) jlptSel.value = '';
        }
        renderVocabList();
    });
    document.getElementById('stv-filter-pos').addEventListener('change', function () { renderVocabList(); });
    document.getElementById('stv-filter-jlpt').addEventListener('change', function () { renderVocabList(); });
    document.getElementById('stv-btn-multiselect').addEventListener('click', function () {
        multiSelectMode = !multiSelectMode;
        this.classList.toggle('stv-active', multiSelectMode);
        var actions = document.getElementById('stv-multi-actions');
        if (actions) actions.style.display = multiSelectMode ? 'flex' : 'none';
        if (!multiSelectMode) selectedWordIds.clear();
        renderVocabList();
    });
    document.getElementById('stv-select-all').addEventListener('click', function () {
        var cards = document.querySelectorAll('#stv-word-list .stv-word-card');
        cards.forEach(function (c) {
            selectedWordIds.add(c.dataset.id);
            c.classList.add('stv-selected');
        });
        updateSelectCount();
    });
    document.getElementById('stv-deselect-all').addEventListener('click', function () {
        selectedWordIds.clear();
        document.querySelectorAll('#stv-word-list .stv-word-card').forEach(function (c) { c.classList.remove('stv-selected'); });
        updateSelectCount();
    });
    document.getElementById('stv-delete-selected').addEventListener('click', function () {
        if (selectedWordIds.size === 0) return;
        if (!confirm(selectedWordIds.size + '개 단어를 삭제하시겠습니까?')) return;
        selectedWordIds.forEach(function (id) { removeVocabWord(id); });
        toastr.info(selectedWordIds.size + '개 단어 삭제됨');
        selectedWordIds.clear();
        updateSelectCount();
        renderVocabList();
        setTimeout(function () { refreshVocabHighlightsInChat(); }, 100);
    });
    // backdrop click to close panel on mobile
    backdrop.addEventListener('click', function () {
        exitMultiSelectMode();
        toggleVocabPanel();
    });
}

function exitMultiSelectMode() {
    multiSelectMode = false;
    selectedWordIds.clear();
    var btn = document.getElementById('stv-btn-multiselect');
    if (btn) btn.classList.remove('stv-active');
    var actions = document.getElementById('stv-multi-actions');
    if (actions) actions.style.display = 'none';
}

function updateSelectCount() {
    var el = document.getElementById('stv-select-count');
    if (el) el.textContent = selectedWordIds.size + '개 선택';
}

function toggleVocabPanel() {
    vocabPanelOpen = !vocabPanelOpen;
    var panel = document.getElementById('stv-panel');
    var backdrop = document.getElementById('stv-backdrop');
    if (panel) panel.classList.toggle('stv-panel-open', vocabPanelOpen);
    if (backdrop) backdrop.classList.toggle('stv-backdrop-show', vocabPanelOpen);
    if (vocabPanelOpen) renderVocabList();
}

// Helper: render grammar badges.
// Derives labels from wordForms (all forms whose word matches the entry's word),
// falling back to grammarInfo field if no wordForms or no matches.
function renderGrammarBadges(wordEntry) {
    var lang = wordEntry.language || 'ja';
    var labels = [];

    // If we have wordForms, find all form labels whose word matches the entry
    if (wordEntry.wordForms && typeof wordEntry.wordForms === 'object' && wordEntry.word) {
        var currentWord = wordEntry.word.toLowerCase();
        Object.keys(wordEntry.wordForms).forEach(function (groupKey) {
            var forms = wordEntry.wordForms[groupKey];
            if (Array.isArray(forms)) {
                forms.forEach(function (form) {
                    if (form.word && form.label && form.word.toLowerCase() === currentWord) {
                        labels.push(form.label);
                    }
                });
            }
        });
    }

    // Fall back to grammarInfo if no matching wordForms found
    if (labels.length === 0 && wordEntry.grammarInfo) {
        labels = wordEntry.grammarInfo.split(/\s*\/\s*/).map(function (g) { return g.trim(); }).filter(Boolean);
    }

    if (labels.length === 0) return '';
    return labels.map(function (label) {
        return '<button class="stv-grammar-badge" data-grammar="' + escapeHtml(label) + '" data-lang="' + lang + '">' + escapeHtml(label) + '</button>';
    }).join('');
}

function renderVocabList() {
    var listEl = document.getElementById('stv-word-list');
    var countEl = document.getElementById('stv-word-count');
    if (!listEl) return;

    var words = getVocab().slice();
    var searchEl = document.getElementById('stv-search');
    var searchQuery = searchEl ? searchEl.value.toLowerCase() : '';
    var langEl = document.getElementById('stv-filter-lang');
    var langFilter = langEl ? langEl.value : '';
    var posEl = document.getElementById('stv-filter-pos');
    var posFilter = posEl ? posEl.value : '';
    var jlptEl = document.getElementById('stv-filter-jlpt');
    var jlptFilter = jlptEl ? jlptEl.value : '';

    if (searchQuery) {
        words = words.filter(function (w) {
            return w.word.toLowerCase().includes(searchQuery)
                || w.meaning.toLowerCase().includes(searchQuery)
                || w.reading.toLowerCase().includes(searchQuery);
        });
    }
    if (langFilter) words = words.filter(function (w) { return w.language === langFilter; });
    if (posFilter) words = words.filter(function (w) { return w.partOfSpeech === posFilter; });
    if (jlptFilter) words = words.filter(function (w) { return w.jlptLevel === jlptFilter; });

    words.sort(function (a, b) { return new Date(b.addedAt) - new Date(a.addedAt); });

    if (countEl) countEl.textContent = words.length;

    if (words.length === 0) {
        listEl.innerHTML = '<div class="stv-empty">'
            + ((searchQuery || langFilter || posFilter)
                ? '검색 결과가 없습니다.'
                : '저장된 단어가 없습니다.<br><small>채팅에서 텍스트를 선택하거나<br>+ 버튼으로 단어를 추가하세요.</small>')
            + '</div>';
        return;
    }

    listEl.innerHTML = words.map(function (w) {
        var isSelected = selectedWordIds.has(w.id);
        return '<div class="stv-word-card' + (multiSelectMode ? ' stv-selectable' : '') + (isSelected ? ' stv-selected' : '') + '" data-id="' + w.id + '">'
            + '<div class="stv-word-card-header">'
            + '<div class="stv-word-main">'
            + '<span class="stv-word-text">' + escapeHtml(w.word) + '</span>'
            + (w.reading ? '<span class="stv-word-reading">[' + escapeHtml(w.reading) + ']</span>' : '')
            + '</div><div class="stv-word-actions">'
            + '<button class="stv-btn-sm stv-edit-btn" data-id="' + w.id + '" title="정보"><span class="fa-solid fa-circle-info"></span></button>'
            + '<button class="stv-btn-sm stv-delete-btn" data-id="' + w.id + '" title="삭제"><span class="fa-solid fa-trash"></span></button>'
            + '</div></div>'
            + (w.partOfSpeech ? '<span class="stv-pos-badge">' + escapeHtml(w.partOfSpeech) + '</span>' : '')
            + '<span class="stv-lang-badge stv-lang-' + w.language + '">' + getLangLabel(w.language) + '</span>'
            + renderGrammarBadges(w)
            + (w.verbGroup ? '<button class="stv-verb-group-badge" data-verb-group="' + escapeHtml(w.verbGroup) + '" data-lang="' + (w.language || 'ja') + '">' + escapeHtml(w.verbGroup) + '</button>' : '')
            + (w.jlptLevel ? '<span class="stv-jlpt-badge stv-jlpt-' + w.jlptLevel.toLowerCase() + '">' + escapeHtml(w.jlptLevel) + '</span>' : '')
            + (w.meaning ? '<div class="stv-word-meaning">' + formatMeaningHtml(w.meaning) + '</div>' : '')
            + (w.examples && w.examples.length > 0
                ? '<div class="stv-word-examples">' + w.examples.map(function (ex) {
                    var sentence = getExampleSentence(ex);
                    var translation = getExampleTranslation(ex);
                    return '<div class="stv-example">' + escapeHtml(sentence)
                        + (translation ? '<div class="stv-example-translation">' + escapeHtml(translation) + '</div>' : '')
                        + '</div>';
                }).join('') + '</div>'
                : '')
            + '<div class="stv-word-meta"><span class="stv-date">' + formatDate(w.addedAt) + '</span></div>'
            + '</div>';
    }).join('');

    listEl.querySelectorAll('.stv-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showWordInfoDialog(btn.dataset.id);
        });
    });
    listEl.querySelectorAll('.stv-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (confirm('이 단어를 삭제하시겠습니까?')) {
                removeVocabWord(btn.dataset.id);
                toastr.info('단어 삭제됨');
                setTimeout(function () { refreshVocabHighlightsInChat(); }, 100);
            }
        });
    });
    listEl.querySelectorAll('.stv-grammar-badge').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showGrammarInfoModal(btn.getAttribute('data-grammar'), btn.getAttribute('data-lang'));
        });
    });
    listEl.querySelectorAll('.stv-verb-group-badge').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showVerbGroupInfoModal(btn.getAttribute('data-verb-group'), btn.getAttribute('data-lang'));
        });
    });
    if (multiSelectMode) {
        listEl.querySelectorAll('.stv-word-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                // Don't toggle when clicking edit/delete buttons
                if (e.target.closest('.stv-edit-btn') || e.target.closest('.stv-delete-btn')) return;
                var id = card.dataset.id;
                if (selectedWordIds.has(id)) {
                    selectedWordIds.delete(id);
                    card.classList.remove('stv-selected');
                } else {
                    selectedWordIds.add(id);
                    card.classList.add('stv-selected');
                }
                updateSelectCount();
            });
        });
    }
}

// ── Word Dialog (Add/Edit) ────────────────────────────

function extractSentenceFromSelection(selection) {
    if (!selection || selection.rangeCount === 0) return '';
    var range = selection.getRangeAt(0);
    var container = range.startContainer;
    var mesText = null;
    var node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
    while (node && node !== document.body) {
        if (node.classList && node.classList.contains('mes_text')) { mesText = node; break; }
        node = node.parentNode;
    }
    if (!mesText) return '';
    var fullText = getCleanText(mesText);
    var selectedText = getCleanSelectedText(selection);
    if (!selectedText) return '';
    var idx = fullText.indexOf(selectedText);
    if (idx === -1) return '';
    var sentenceEnders = /[。.！!？?\n]/;
    var start = idx;
    while (start > 0) { if (sentenceEnders.test(fullText[start - 1])) break; start--; }
    var end = idx + selectedText.length;
    while (end < fullText.length) { if (sentenceEnders.test(fullText[end])) { end++; break; } end++; }
    return fullText.slice(start, end).trim();
}

/**
 * Get display-friendly sentence from an example item.
 * Handles both old string format and new {sentence, translation} format.
 */
function getExampleSentence(ex) {
    if (typeof ex === 'string') return ex;
    if (ex && typeof ex === 'object') return ex.sentence || '';
    return String(ex);
}

function getExampleTranslation(ex) {
    if (ex && typeof ex === 'object') return ex.translation || '';
    return '';
}

/**
 * Format meaning text for HTML display.
 * Converts numbered meanings (1. xxx\n2. xxx) to proper HTML with line breaks.
 */
function formatMeaningHtml(text) {
    if (!text) return '';
    // Split by newlines, escape each line, join with <br>
    return text.split('\n').map(function (line) {
        return escapeHtml(line.trim());
    }).filter(function (l) { return l; }).join('<br>');
}

/**
 * Add an example entry row to the dialog examples list.
 */
function addExampleEntryRow(listEl, sentence, translation, hideTranslation) {
    var entry = document.createElement('div');
    entry.className = 'stv-dlg-example-entry';
    var sentenceRow = document.createElement('div');
    sentenceRow.className = 'stv-dlg-example-sentence-row';
    var sentenceInput = document.createElement('input');
    sentenceInput.type = 'text';
    sentenceInput.className = 'stv-dlg-example-sentence';
    sentenceInput.placeholder = '예문을 입력하세요';
    sentenceInput.value = sentence || '';
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'stv-dlg-example-remove';
    removeBtn.title = '삭제';
    removeBtn.innerHTML = '<span class="fa-solid fa-xmark"></span>';
    removeBtn.addEventListener('click', function () { entry.remove(); });
    sentenceRow.appendChild(sentenceInput);
    sentenceRow.appendChild(removeBtn);
    var translationInput = document.createElement('input');
    translationInput.type = 'text';
    translationInput.className = 'stv-dlg-example-translation';
    translationInput.placeholder = '해석 (한국어)';
    translationInput.value = translation || '';
    if (hideTranslation) translationInput.style.display = 'none';
    entry.appendChild(sentenceRow);
    entry.appendChild(translationInput);
    listEl.appendChild(entry);
    return entry;
}

/**
 * Read all example entries from the dialog list.
 */
function getExamplesFromList() {
    var listEl = document.getElementById('stv-dlg-examples-list');
    if (!listEl) return [];
    var entries = listEl.querySelectorAll('.stv-dlg-example-entry');
    var examples = [];
    entries.forEach(function (entry) {
        var sentenceEl = entry.querySelector('.stv-dlg-example-sentence');
        var sentence = sentenceEl ? sentenceEl.value.trim() : '';
        if (!sentence) return;
        var translationEl = entry.querySelector('.stv-dlg-example-translation');
        var translation = translationEl ? translationEl.value.trim() : '';
        examples.push({ sentence: sentence, translation: translation });
    });
    return examples;
}

/**
 * Check if the currently selected word language is Korean.
 */
function isCurrentWordKorean() {
    var langSel = document.getElementById('stv-dlg-lang');
    if (!langSel) return false;
    var val = langSel.value;
    if (val === 'ko') return true;
    if (val === 'auto') {
        var wordInput = document.getElementById('stv-dlg-word');
        var word = wordInput ? wordInput.value.trim() : '';
        return word ? detectLanguage(word) === 'ko' : false;
    }
    return false;
}

/**
 * Show read-only word info modal. "수정" button opens the edit dialog.
 */
function showWordInfoDialog(wordId) {
    var w = getVocab().find(function (v) { return v.id === wordId; });
    if (!w) return;

    var existingOverlay = document.getElementById('stv-info-overlay');
    if (existingOverlay) existingOverlay.remove();

    var examplesHtml = '';
    if (w.examples && w.examples.length > 0) {
        examplesHtml = '<div class="stv-info-section"><h4>예문</h4>';
        w.examples.forEach(function (ex, idx) {
            var sentence = getExampleSentence(ex);
            var translation = getExampleTranslation(ex);
            examplesHtml += '<div class="stv-info-example"><span class="stv-info-ex-num">' + (idx + 1) + '.</span> '
                + escapeHtml(sentence)
                + (translation ? '<div class="stv-info-ex-translation">→ ' + escapeHtml(translation) + '</div>' : '')
                + '</div>';
        });
        examplesHtml += '</div>';
    }

    // Build kanji breakdown section
    var kanjiHtml = '';
    if (w.kanjiBreakdown && Array.isArray(w.kanjiBreakdown) && w.kanjiBreakdown.length > 0) {
        kanjiHtml = '<div class="stv-info-section stv-kanji-section"><h4>한자 분해</h4>';
        w.kanjiBreakdown.forEach(function (k) {
            kanjiHtml += '<div class="stv-kanji-item">'
                + '<span class="stv-kanji-char">' + escapeHtml(k.kanji || '') + '</span>'
                + '<div class="stv-kanji-detail">'
                + '<span class="stv-kanji-meaning">' + escapeHtml(k.meaning || '') + '</span>'
                + (k.onyomi ? '<span class="stv-kanji-reading">음: ' + escapeHtml(k.onyomi) + '</span>' : '')
                + (k.kunyomi ? '<span class="stv-kanji-reading">훈: ' + escapeHtml(k.kunyomi) + '</span>' : '')
                + '</div></div>';
        });
        kanjiHtml += '</div>';
    }

    // Build word forms section
    var wordFormsHtml = '';
    if (w.wordForms && typeof w.wordForms === 'object') {
        var vocabWords = new Set(getVocab().map(function (v) { return v.word; }));
        var formGroups = Object.keys(w.wordForms);
        if (formGroups.length > 0) {
            wordFormsHtml = '<div class="stv-info-section stv-wordforms-section"><h4>활용형</h4>';
            formGroups.forEach(function (groupLabel) {
                var forms = w.wordForms[groupLabel];
                if (!Array.isArray(forms) || forms.length === 0) return;
                wordFormsHtml += '<div class="stv-wordforms-group">';
                wordFormsHtml += '<span class="stv-wordforms-group-label">' + escapeHtml(groupLabel) + '</span>';
                wordFormsHtml += '<div class="stv-wordforms-chips">';
                forms.forEach(function (form) {
                    var formWord = form.word || '';
                    var formLabel = form.label || '';
                    var inVocab = vocabWords.has(formWord);
                    wordFormsHtml += '<button class="stv-wordform-chip' + (inVocab ? ' stv-wordform-in-vocab' : '') + '" '
                        + 'data-form-word="' + escapeHtml(formWord) + '" '
                        + 'title="' + escapeHtml(formLabel + (inVocab ? ' (단어장에 있음)' : ' — 클릭하여 추가')) + '">'
                        + '<span class="stv-wordform-label">' + escapeHtml(formLabel) + '</span> '
                        + '<span class="stv-wordform-word">' + escapeHtml(formWord) + '</span>'
                        + (inVocab ? ' <span class="fa-solid fa-check stv-wordform-check"></span>' : '')
                        + '</button>';
                });
                wordFormsHtml += '</div></div>';
            });
            wordFormsHtml += '</div>';
        }
    }

    // Build base form link
    var baseFormHtml = '';
    if (w.baseForm) {
        baseFormHtml = '<div class="stv-info-baseform">'
            + '<span class="stv-baseform-label">원형</span>'
            + '<button class="stv-baseform-btn" id="stv-info-baseform-btn" '
            + 'data-baseform="' + escapeHtml(w.baseForm) + '">'
            + escapeHtml(w.baseForm)
            + '</button></div>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'stv-info-overlay';
    overlay.className = 'stv-dialog-overlay';
    overlay.innerHTML = '<div class="stv-dialog stv-info-dialog">'
        + '<div class="stv-dialog-header"><h3>단어 정보</h3>'
        + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
        + '<div class="stv-dialog-body">'
        + '<div class="stv-info-word-header">'
        + '<span class="stv-info-word">' + escapeHtml(w.word) + '</span>'
        + (w.reading ? '<span class="stv-info-reading">[' + escapeHtml(w.reading) + ']</span>' : '')
        + '</div>'
        + '<div class="stv-info-badges">'
        + (w.partOfSpeech ? '<span class="stv-pos-badge">' + escapeHtml(w.partOfSpeech) + '</span>' : '')
        + '<span class="stv-lang-badge stv-lang-' + w.language + '" style="display: flex; align-items: center; justify-content: center;">' + getLangLabel(w.language) + '</span>'
        + renderGrammarBadges(w)
        + (w.verbGroup ? '<button class="stv-verb-group-badge" data-verb-group="' + escapeHtml(w.verbGroup) + '" data-lang="' + (w.language || 'ja') + '">' + escapeHtml(w.verbGroup) + '</button>' : '')
        + (w.jlptLevel ? '<span class="stv-jlpt-badge stv-jlpt-' + w.jlptLevel.toLowerCase() + '">' + escapeHtml(w.jlptLevel) + '</span>' : '')
        + '</div>'
        + baseFormHtml
        + (w.meaning ? '<div class="stv-info-section"><h4>뜻</h4><div class="stv-info-meaning">' + formatMeaningHtml(w.meaning) + '</div></div>' : '')
        + examplesHtml
        + kanjiHtml
        + wordFormsHtml
        + '<div class="stv-info-meta"><span class="stv-date">추가일: ' + formatDate(w.addedAt) + '</span></div>'
        + '</div>'
        + '<div class="stv-dialog-footer">'
        + '<button class="stv-btn stv-btn-delete" id="stv-info-delete"><span class="fa-solid fa-trash-can"></span> 삭제</button>'
        + '<div class="stv-dialog-footer-right">'
        + '<button class="stv-btn stv-btn-cancel" id="stv-info-close">닫기</button>'
        + '<button class="stv-btn stv-btn-edit" id="stv-info-edit"><span class="fa-solid fa-pen"></span> 수정</button>'
        + '</div></div></div>';
    document.body.appendChild(overlay);

    var closeInfo = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeInfo);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeInfo(); });
    document.getElementById('stv-info-close').addEventListener('click', closeInfo);
    document.getElementById('stv-info-edit').addEventListener('click', function () {
        closeInfo();
        showWordDialog(wordId);
    });
    document.getElementById('stv-info-delete').addEventListener('click', function () {
        if (!confirm('"' + w.word + '" 단어를 삭제하시겠습니까?')) return;
        removeVocabWord(wordId);
        closeInfo();
        toastr.info('"' + w.word + '" 삭제됨');
        renderVocabList();
        setTimeout(function () { refreshVocabHighlightsInChat(); }, 100);
    });

    // Base form button click handler
    var baseFormBtn = document.getElementById('stv-info-baseform-btn');
    if (baseFormBtn) {
        baseFormBtn.addEventListener('click', function () {
            var baseWord = baseFormBtn.getAttribute('data-baseform');
            if (!baseWord) return;
            var vocabItem = getVocab().find(function (v) { return v.word === baseWord; });
            if (vocabItem) {
                closeInfo();
                showWordInfoDialog(vocabItem.id);
            } else {
                closeInfo();
                showWordDialog(null, { initWord: baseWord });
            }
        });
    }

    // Word form chip click handlers
    overlay.querySelectorAll('.stv-wordform-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            var formWord = chip.getAttribute('data-form-word');
            if (!formWord) return;
            var vocabItem = getVocab().find(function (v) { return v.word === formWord; });
            if (vocabItem) {
                // Already in vocab → show its info
                closeInfo();
                showWordInfoDialog(vocabItem.id);
            } else {
                // Not in vocab → open add dialog prefilled
                closeInfo();
                showWordDialog(null, { initWord: formWord });
            }
        });
    });

    // Grammar badge click handler
    overlay.querySelectorAll('.stv-grammar-badge').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showGrammarInfoModal(btn.getAttribute('data-grammar'), btn.getAttribute('data-lang'));
        });
    });

    // Verb group badge click handler
    overlay.querySelectorAll('.stv-verb-group-badge').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showVerbGroupInfoModal(btn.getAttribute('data-verb-group'), btn.getAttribute('data-lang'));
        });
    });
}

async function showWordDialog(editId, opts) {
    if (!editId) editId = null;
    if (!opts) opts = {};
    var contextSentence = opts.contextSentence || '';
    var initWord = opts.initWord || '';
    var existingOverlay = document.getElementById('stv-dialog-overlay');
    if (existingOverlay) existingOverlay.remove();

    var isEdit = !!editId;
    var existing = null;
    if (isEdit) {
        existing = getVocab().find(function (w) { return w.id === editId; });
        if (!existing) return;
    }

    var posOptions = ['명사', '동사', '형용사', '부사', '접속사', '조사', '감탄사', '대명사', '전치사', '조동사', '연체사', '접미사', '접두사', '기타'];
    var posHtml = '<option value="">선택...</option>';
    posOptions.forEach(function (p) {
        posHtml += '<option value="' + p + '"' + ((existing && existing.partOfSpeech === p) ? ' selected' : '') + '>' + p + '</option>';
    });

    var contextHtml = '';
    if (contextSentence) {
        contextHtml = '<div class="stv-field stv-context-field">'
            + '<label><input type="checkbox" id="stv-dlg-use-context" checked /> 채팅 문장을 예문으로 추가</label>'
            + '<input type="text" id="stv-dlg-context-sentence" class="stv-context-input" value="' + escapeHtml(contextSentence) + '" placeholder="예문" />'
            + '<input type="text" id="stv-dlg-context-translation" class="stv-context-translation" placeholder="해석 (한국어)" />'
            + '</div>';
    }

    // Language selector options
    var langOptions = [
        { val: 'auto', label: '자동' },
        { val: 'ja', label: '日本語' },
        { val: 'en', label: 'English' },
        { val: 'ko', label: '한국어' },
        { val: 'zh', label: '中文' },
        { val: 'other', label: '기타' },
    ];
    var currentLang = isEdit && existing ? (existing.language || 'auto') : 'auto';
    var langSelectHtml = '';
    langOptions.forEach(function (opt) {
        langSelectHtml += '<option value="' + opt.val + '"' + (opt.val === currentLang ? ' selected' : '') + '>' + opt.label + '</option>';
    });

    var overlay = document.createElement('div');
    overlay.id = 'stv-dialog-overlay';
    overlay.className = 'stv-dialog-overlay';
    overlay.innerHTML = '<div class="stv-dialog">'
        + '<div class="stv-dialog-header"><h3>' + (isEdit ? '단어 수정' : '단어 추가') + '</h3>'
        + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
        + '<div class="stv-dialog-body">'
        + '<div class="stv-field"><label>단어 <span class="stv-required">*</span></label>'
        + '<div class="stv-word-row">'
        + '<input type="text" id="stv-dlg-word" value="' + escapeHtml(existing ? existing.word : (initWord || '')) + '" placeholder="단어를 입력하세요" />'
        + '<select id="stv-dlg-lang" title="언어 선택">' + langSelectHtml + '</select>'
        + '</div>'
        + '<button type="button" class="stv-btn stv-btn-baseform" id="stv-dlg-find-baseform" title="AI로 원형을 찾아 새 다이얼로그를 엽니다">'
        + '<span class="fa-solid fa-magnifying-glass"></span> 원형 찾기</button>'
        + '</div>'
        + '<div class="stv-field"><label>발음 / 읽기</label>'
        + '<input type="text" id="stv-dlg-reading" value="' + escapeHtml(existing ? existing.reading : '') + '" placeholder="히라가나, IPA, 병음 등" /></div>'
        + '<div class="stv-field"><label>뜻</label>'
        + '<textarea id="stv-dlg-meaning" rows="2" placeholder="한국어 뜻">' + escapeHtml(existing ? existing.meaning : '') + '</textarea></div>'
        + '<div class="stv-field"><label>품사</label><select id="stv-dlg-pos">' + posHtml + '</select></div>'
        + '<div class="stv-field"><label>문법 정보 (활용형)</label>'
        + '<input type="text" id="stv-dlg-grammar" value="' + escapeHtml(existing ? (existing.grammarInfo || '') : '') + '" placeholder="예: 과거형, 수동형, て형 등" /></div>'
        + '<div class="stv-field-row" id="stv-dlg-ja-fields">'
        + '<div class="stv-field stv-field-half"><label>동사 그룹</label>'
        + '<select id="stv-dlg-verb-group"><option value="">없음</option>'
        + ['五段', '一段', 'サ変', 'カ変'].map(function (g) {
            return '<option value="' + g + '"' + ((existing && existing.verbGroup === g) ? ' selected' : '') + '>' + g + '</option>';
        }).join('') + '</select></div>'
        + '<div class="stv-field stv-field-half"><label>JLPT</label>'
        + '<select id="stv-dlg-jlpt"><option value="">없음</option>'
        + ['N5', 'N4', 'N3', 'N2', 'N1'].map(function (lv) {
            return '<option value="' + lv + '"' + ((existing && existing.jlptLevel === lv) ? ' selected' : '') + '>' + lv + '</option>';
        }).join('') + '</select></div></div>'
        + contextHtml
        + '<div class="stv-field stv-examples-field"><label>예문</label>'
        + '<div id="stv-dlg-examples-list" class="stv-dlg-examples-list"></div>'
        + '<button type="button" class="stv-btn stv-add-example-row-btn" id="stv-dlg-add-example-row">'
        + '<span class="fa-solid fa-plus"></span> 예문 추가</button></div>'
        + '<div class="stv-dialog-btn-row">'
        + '<button id="stv-dlg-analyze" class="stv-btn stv-btn-analyze">'
        + '<span class="fa-solid fa-wand-magic-sparkles"></span> AI 자동 분석</button>'
        + '<button id="stv-dlg-add-examples" class="stv-btn stv-btn-add-examples">'
        + '<span class="fa-solid fa-list-check"></span> AI 예문 추가</button>'
        + '</div>'
        + '</div>'
        + '<div class="stv-dialog-footer">'
        + '<button class="stv-btn stv-btn-cancel">취소</button>'
        + '<button class="stv-btn stv-btn-save">저장</button></div></div>';
    document.body.appendChild(overlay);

    var closeDialog = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeDialog);
    overlay.querySelector('.stv-btn-cancel').addEventListener('click', closeDialog);

    // Populate existing examples
    var examplesList = document.getElementById('stv-dlg-examples-list');
    var existingExamples = existing && existing.examples ? existing.examples : [];
    existingExamples.forEach(function (ex) {
        var sentence = typeof ex === 'string' ? ex : (ex.sentence || '');
        var translation = typeof ex === 'string' ? '' : (ex.translation || '');
        addExampleEntryRow(examplesList, sentence, translation, isCurrentWordKorean());
    });

    document.getElementById('stv-dlg-add-example-row').addEventListener('click', function () {
        addExampleEntryRow(examplesList, '', '', isCurrentWordKorean());
        var entries = examplesList.querySelectorAll('.stv-dlg-example-entry');
        var lastEntry = entries[entries.length - 1];
        if (lastEntry) lastEntry.querySelector('.stv-dlg-example-sentence').focus();
    });

    // Language change → toggle translation input visibility & language-specific fields
    function updateLangFields() {
        var langSel = document.getElementById('stv-dlg-lang');
        var selectedLang = langSel ? langSel.value : 'auto';
        var effectiveLang = selectedLang;
        if (effectiveLang === 'auto') {
            var wordInput = document.getElementById('stv-dlg-word');
            var wordVal = wordInput ? wordInput.value.trim() : '';
            effectiveLang = wordVal ? detectLanguage(wordVal) : 'ja';
        }

        var isKo = (effectiveLang === 'ko');
        var isJa = (effectiveLang === 'ja');

        // Toggle translation inputs
        examplesList.querySelectorAll('.stv-dlg-example-translation').forEach(function (el) {
            el.style.display = isKo ? 'none' : '';
        });
        var ctxTrans = document.getElementById('stv-dlg-context-translation');
        if (ctxTrans) ctxTrans.style.display = isKo ? 'none' : '';

        // Toggle Japanese-specific fields (동사 그룹, JLPT)
        var jaFields = document.getElementById('stv-dlg-ja-fields');
        if (jaFields) jaFields.style.display = isJa ? '' : 'none';

        // Update reading placeholder based on language
        var readingInput = document.getElementById('stv-dlg-reading');
        if (readingInput) {
            var placeholders = { ja: '히라가나', en: 'IPA (예: /wɔːk/)', ko: '', zh: '병음 (pīnyīn)', other: '발음 표기' };
            readingInput.placeholder = placeholders[effectiveLang] || '히라가나, IPA, 병음 등';
        }

        // Update grammar info placeholder based on language
        var grammarInput = document.getElementById('stv-dlg-grammar');
        if (grammarInput) {
            var grammarPlaceholders = {
                ja: '예: 과거형, 수동형, て형 등',
                en: '예: 과거형, 과거 분사, -ing형, 비교급 등',
                ko: '예: 과거형, 진행형, 피동형 등',
                zh: '예: 과거형, 진행형 등',
                other: '활용형 정보'
            };
            grammarInput.placeholder = grammarPlaceholders[effectiveLang] || grammarPlaceholders.ja;
        }
    }

    document.getElementById('stv-dlg-lang').addEventListener('change', updateLangFields);
    // Also update when the word input changes (auto-detect language from typed word)
    var wordInputEl = document.getElementById('stv-dlg-word');
    if (wordInputEl) wordInputEl.addEventListener('input', updateLangFields);
    // Run once on init to set correct state
    updateLangFields();

    // Track whether AI analysis was used and detected base form
    var detectedBaseForm = null;
    var detectedWordForms = null;
    var detectedKanjiBreakdown = null;

    // ── Base form find button ──
    overlay.querySelector('#stv-dlg-find-baseform').addEventListener('click', async function () {
        var wordInput = document.getElementById('stv-dlg-word');
        var wordVal = wordInput ? wordInput.value.trim() : '';
        if (!wordVal) { toastr.warning('먼저 단어를 입력하세요.'); return; }
        var findBtn = overlay.querySelector('#stv-dlg-find-baseform');
        findBtn.disabled = true;
        findBtn.innerHTML = '<span class="fa-solid fa-spinner fa-spin"></span>';
        var langSel = document.getElementById('stv-dlg-lang');
        var selectedLang = langSel ? langSel.value : 'auto';
        try {
            var bf = await detectBaseForm(wordVal, selectedLang);
            if (bf) {
                // Gather current contextSentence if available
                var ctxEl = document.getElementById('stv-dlg-context-sentence');
                var curCtx = ctxEl ? ctxEl.value.trim() : contextSentence;
                closeDialog();
                toastr.info('"' + wordVal + '" → 원형 "' + bf + '"으로 새 다이얼로그를 엽니다.');
                showWordDialog(null, { initWord: bf, contextSentence: curCtx });
            } else {
                toastr.info('"' + wordVal + '"은(는) 이미 원형입니다.');
            }
        } catch (e) {
            console.error('[ST-Vocabulary] Base form lookup error:', e);
            toastr.error('원형 검색에 실패했습니다.');
        }
        findBtn.disabled = false;
        findBtn.innerHTML = '<span class="fa-solid fa-magnifying-glass"></span> 원형 찾기';
    });

    // AI Analyze
    overlay.querySelector('#stv-dlg-analyze').addEventListener('click', async function () {
        var wordInput = document.getElementById('stv-dlg-word');
        var wordVal = wordInput ? wordInput.value.trim() : '';
        if (!wordVal) { toastr.warning('먼저 단어를 입력하세요.'); return; }
        var analyzeBtn = overlay.querySelector('#stv-dlg-analyze');
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span class="fa-solid fa-spinner fa-spin"></span> 분석 중...';
        detectedBaseForm = null;
        // Get selected language from dropdown
        var langSel = document.getElementById('stv-dlg-lang');
        var selectedLang = langSel ? langSel.value : 'auto';
        try {
            // Run word analysis and base form detection in parallel
            var ctxEl = document.getElementById('stv-dlg-context-sentence');
            var curCtx = ctxEl ? ctxEl.value.trim() : contextSentence;
            var [result, baseForm] = await Promise.all([
                analyzeWordWithLLM(wordVal, selectedLang, curCtx),
                detectBaseForm(wordVal, selectedLang),
            ]);
            if (result) {
                // Determine effective language for reading normalization
                var effectiveLang = (selectedLang !== 'auto') ? selectedLang : detectLanguage(wordVal, result.reading);
                if (result.reading) document.getElementById('stv-dlg-reading').value = normalizeReading(result.reading, effectiveLang);
                if (result.meaning) document.getElementById('stv-dlg-meaning').value = result.meaning;
                if (result.partOfSpeech) {
                    var normalized = normalizePartOfSpeech(result.partOfSpeech);
                    var sel = document.getElementById('stv-dlg-pos');
                    var found = false;
                    for (var i = 0; i < sel.options.length; i++) {
                        if (sel.options[i].value === normalized) { found = true; sel.value = normalized; break; }
                    }
                    if (!found && normalized) {
                        // Add as new option if not in list
                        var opt = document.createElement('option');
                        opt.value = normalized;
                        opt.textContent = normalized;
                        opt.selected = true;
                        sel.insertBefore(opt, sel.lastElementChild); // before "기타"
                    }
                }
                if (result.grammarInfo) {
                    var grammarEl = document.getElementById('stv-dlg-grammar');
                    if (grammarEl) grammarEl.value = result.grammarInfo;
                }
                if (result.verbGroup) {
                    var vgSel = document.getElementById('stv-dlg-verb-group');
                    if (vgSel) vgSel.value = result.verbGroup;
                }
                if (result.jlptLevel) {
                    var jlptSel = document.getElementById('stv-dlg-jlpt');
                    if (jlptSel) jlptSel.value = result.jlptLevel;
                }
                if (result.examples && Array.isArray(result.examples)) {
                    var exList = document.getElementById('stv-dlg-examples-list');
                    if (exList) {
                        exList.innerHTML = '';
                        var isKo = isCurrentWordKorean();
                        result.examples.forEach(function (ex) {
                            var sentence = typeof ex === 'object' ? (ex.sentence || '') : String(ex);
                            var translation = typeof ex === 'object' ? (ex.translation || '') : '';
                            addExampleEntryRow(exList, sentence, translation, isKo);
                        });
                    }
                }
                // Translate context sentence if present (skip for Korean)
                var useContextEl = document.getElementById('stv-dlg-use-context');
                var contextEl = document.getElementById('stv-dlg-context-sentence');
                var ctxTransEl = document.getElementById('stv-dlg-context-translation');
                if (!isCurrentWordKorean() && useContextEl && useContextEl.checked && contextEl && contextEl.value.trim() && ctxTransEl && !ctxTransEl.value.trim()) {
                    try {
                        var transPrompt = 'Translate the following sentence to Korean. Return ONLY the Korean translation, nothing else.\n\nSentence: ' + contextEl.value.trim() + '\n\nTranslation:';
                        var translation = await callLLM(transPrompt);
                        if (translation && translation.trim()) {
                            ctxTransEl.value = translation.trim();
                        }
                    } catch (e) { /* ignore translation failure */ }
                }
                toastr.success('AI 분석 완료!');
            } else {
                toastr.error('AI 분석에 실패했습니다.');
            }
            detectedBaseForm = baseForm;
            // Fallback: use baseForm from analysis result if detectBaseForm returned null
            if (!detectedBaseForm && result && result.baseForm && result.baseForm !== wordVal && result.baseForm.trim()) {
                detectedBaseForm = result.baseForm.trim();
            }
            detectedWordForms = (result && result.wordForms && typeof result.wordForms === 'object') ? result.wordForms : null;
            detectedKanjiBreakdown = (result && result.kanjiBreakdown && Array.isArray(result.kanjiBreakdown)) ? result.kanjiBreakdown : null;

        } catch (e) {
            console.error('[ST-Vocabulary] AI analyze error:', e);
            toastr.error('AI 분석 중 오류 발생');
        }
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = '<span class="fa-solid fa-wand-magic-sparkles"></span> AI 자동 분석';
    });

    // AI Add Examples
    overlay.querySelector('#stv-dlg-add-examples').addEventListener('click', async function () {
        var wordInput = document.getElementById('stv-dlg-word');
        var wordVal = wordInput ? wordInput.value.trim() : '';
        if (!wordVal) { toastr.warning('먼저 단어를 입력하세요.'); return; }
        var addExBtn = overlay.querySelector('#stv-dlg-add-examples');
        addExBtn.disabled = true;
        addExBtn.innerHTML = '<span class="fa-solid fa-spinner fa-spin"></span> 예문 생성 중...';
        try {
            var existingParsed = getExamplesFromList();
            var newExamples = await generateExamplesWithLLM(wordVal, existingParsed, (function () {
                var ls = document.getElementById('stv-dlg-lang');
                return ls ? ls.value : 'auto';
            })());
            if (newExamples && newExamples.length > 0) {
                var exList = document.getElementById('stv-dlg-examples-list');
                if (exList) {
                    var isKo = isCurrentWordKorean();
                    newExamples.forEach(function (ex) {
                        addExampleEntryRow(exList, ex.sentence || '', ex.translation || '', isKo);
                    });
                }
                toastr.success(newExamples.length + '개 예문 추가됨');
            } else {
                toastr.error('예문 생성에 실패했습니다.');
            }
        } catch (e) {
            console.error('[ST-Vocabulary] AI examples error:', e);
            toastr.error('예문 생성 중 오류 발생');
        }
        addExBtn.disabled = false;
        addExBtn.innerHTML = '<span class="fa-solid fa-list-check"></span> AI 예문 추가';
    });

    // Save
    overlay.querySelector('.stv-btn-save').addEventListener('click', async function () {
        var wordEl = document.getElementById('stv-dlg-word');
        var word = wordEl ? wordEl.value.trim() : '';
        if (!word) { toastr.warning('단어를 입력하세요.'); return; }
        var readingEl = document.getElementById('stv-dlg-reading');
        var reading = readingEl ? readingEl.value.trim() : '';
        var meaningEl = document.getElementById('stv-dlg-meaning');
        var meaning = meaningEl ? meaningEl.value.trim() : '';
        var posEl2 = document.getElementById('stv-dlg-pos');
        var partOfSpeech = posEl2 ? posEl2.value : '';
        var grammarEl = document.getElementById('stv-dlg-grammar');
        var grammarInfo = grammarEl ? grammarEl.value.trim() : '';
        var vgSel2 = document.getElementById('stv-dlg-verb-group');
        var verbGroup = vgSel2 ? vgSel2.value : '';
        var jlptSel2 = document.getElementById('stv-dlg-jlpt');
        var jlptLevel = jlptSel2 ? jlptSel2.value : '';
        var extraExamples = getExamplesFromList();
        var examples = [];
        var useContext = document.getElementById('stv-dlg-use-context');
        var contextInput = document.getElementById('stv-dlg-context-sentence');
        var ctxTransInput = document.getElementById('stv-dlg-context-translation');
        if (useContext && useContext.checked && contextInput && contextInput.value.trim()) {
            examples.push({
                sentence: contextInput.value.trim(),
                translation: ctxTransInput ? ctxTransInput.value.trim() : '',
            });
        }
        examples = examples.concat(extraExamples);

        // Determine language from selector
        var langSel = document.getElementById('stv-dlg-lang');
        var selectedLang = langSel ? langSel.value : 'auto';
        var finalLang = (selectedLang !== 'auto') ? selectedLang : detectLanguage(word, reading);

        if (isEdit) {
            var editUpdates = { word: word, reading: reading, meaning: meaning, partOfSpeech: partOfSpeech, grammarInfo: grammarInfo, examples: examples, language: finalLang, verbGroup: verbGroup || null, jlptLevel: jlptLevel || null };
            if (detectedWordForms) editUpdates.wordForms = detectedWordForms;
            if (detectedBaseForm) editUpdates.baseForm = detectedBaseForm;
            if (detectedKanjiBreakdown) editUpdates.kanjiBreakdown = detectedKanjiBreakdown;
            updateVocabWord(editId, editUpdates);
            toastr.success('"' + word + '" 수정 완료');
        } else {
            var addData = { word: word, reading: reading, meaning: meaning, partOfSpeech: partOfSpeech, grammarInfo: grammarInfo, examples: examples, language: finalLang, source: 'manual', verbGroup: verbGroup || null, jlptLevel: jlptLevel || null };
            if (detectedWordForms) addData.wordForms = detectedWordForms;
            if (detectedBaseForm) addData.baseForm = detectedBaseForm;
            if (detectedKanjiBreakdown) addData.kanjiBreakdown = detectedKanjiBreakdown;
            addVocabWord(addData);
            toastr.success('"' + word + '" 단어장에 추가됨');
        }
        closeDialog();
        // Re-highlight vocab words in chat after add/edit
        setTimeout(function () { refreshVocabHighlightsInChat(); }, 100);

        // Detect and suggest base form (after dialog closed)
        if (!isEdit) {
            try {
                var bf = detectedBaseForm;
                console.log('[ST-Vocabulary] Base form check: detectedBaseForm =', bf, ', word =', word);
                if (!bf) {
                    console.log('[ST-Vocabulary] No cached base form, calling detectBaseForm...');
                    bf = await detectBaseForm(word, finalLang);
                    console.log('[ST-Vocabulary] detectBaseForm returned:', bf);
                }
                if (bf) {
                    console.log('[ST-Vocabulary] Showing base form snackbar:', word, '→', bf);
                    showBaseFormSnackbar(word, bf);
                } else {
                    console.log('[ST-Vocabulary] No base form detected (word is already base form)');
                }
            } catch (e) {
                console.error('[ST-Vocabulary] Base form detection failed:', e);
            }
        }
    });

    setTimeout(function () { var el = document.getElementById('stv-dlg-word'); if (el) el.focus(); }, 100);
}

// ── Vocab Highlight Click Delegation ──────────────────

/**
 * Use event delegation on #chat to handle clicks on vocab-highlighted words.
 * This is more robust than per-element handlers since it works regardless of
 * DOM changes, re-renders, or timing issues.
 */
function setupVocabHighlightClickDelegation() {
    document.addEventListener('click', function (e) {
        // Check for .stv-vocab-hl-span click
        var hlSpan = e.target.closest('.stv-vocab-hl-span[data-stv-word]');
        if (!hlSpan) {
            // Also check for .stv-ruby.stv-vocab-highlight click
            hlSpan = e.target.closest('.stv-ruby.stv-vocab-highlight[data-stv-word]');
        }
        if (!hlSpan) return;
        // Only handle clicks within #chat .mes .mes_text
        if (!hlSpan.closest('#chat .mes .mes_text')) return;

        e.stopPropagation();
        e.preventDefault();
        var wordText = hlSpan.getAttribute('data-stv-word');
        if (!wordText) return;

        // Check if this word is individually saved in vocab
        var vocabItem = getVocab().find(function (v) { return v.word === wordText; });
        if (vocabItem) {
            showWordInfoDialog(vocabItem.id);
            return;
        }

        // Check if this is a conjugated form mapping to a base word
        var baseId = hlSpan.getAttribute('data-stv-base-id');
        if (baseId) {
            var baseItem = getVocab().find(function (v) { return v.id === baseId; });
            if (baseItem) {
                showWordInfoDialog(baseItem.id);
                return;
            }
        }
    }, true); // useCapture to fire before other handlers
}

// ── Furigana Edit Click Delegation ────────────────────

var _furiganaEditActive = false;

function closeFuriganaEditPopup() {
    document.querySelectorAll('.stv-furigana-edit-popup').forEach(function (p) { p.remove(); });
    _furiganaEditActive = false;
}

function setupFuriganaEditDelegation() {
    // Track mousedown on .stv-ruby to detect simple clicks vs drags
    var _mdRuby = null;   // the ruby element pressed on mousedown
    var _mdX = 0, _mdY = 0; // mousedown coordinates

    // Phase 1: record mousedown target
    document.addEventListener('mousedown', function (e) {
        _mdRuby = null;
        var _s = getSettings();
        if (!_s.furiganaEditOnClick) return;

        var ruby = e.target.closest('.stv-ruby');
        if (!ruby) return;
        if (ruby.classList.contains('stv-vocab-highlight')) return;
        if (!ruby.closest('#chat .mes .mes_text')) return;

        _mdRuby = ruby;
        _mdX = e.clientX;
        _mdY = e.clientY;
    }, true);

    // Phase 2: on mouseup, if it was a simple click (not drag) on .stv-ruby,
    // clear selection and show edit popup BEFORE other extensions see the event
    document.addEventListener('mouseup', function (e) {
        if (!_mdRuby) return;
        var ruby = _mdRuby;
        _mdRuby = null;

        // Check if this is a simple click (not a drag): mouse moved < 5px
        var dx = e.clientX - _mdX, dy = e.clientY - _mdY;
        if (Math.sqrt(dx * dx + dy * dy) > 5) return;

        // Verify mouseup target is still within the same ruby or its children
        var upRuby = e.target.closest('.stv-ruby');
        if (upRuby !== ruby) return;

        // Clear any browser-created selection immediately, before other extensions see it
        if (window.getSelection()) window.getSelection().removeAllRanges();

        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        closeFuriganaEditPopup();
        closeFuriganaPopupMenus();
        _furiganaEditActive = true;

        var rtEl = ruby.querySelector('rt');
        if (!rtEl) { _furiganaEditActive = false; return; }
        var currentReading = rtEl.textContent;
        var word = ruby.getAttribute('data-stv-word') || ruby.firstChild.textContent;

        // Create edit popup
        var popup = document.createElement('div');
        popup.className = 'stv-furigana-edit-popup';
        popup.id = 'stv-furigana-edit-popup';
        var input = document.createElement('input');
        input.type = 'text';
        input.value = currentReading;
        input.placeholder = '읽기 입력';
        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = '확인';
        popup.appendChild(input);
        popup.appendChild(confirmBtn);
        document.body.appendChild(popup);

        // Position above the ruby element
        var rect = ruby.getBoundingClientRect();
        popup.style.top = (rect.top + window.scrollY - 40) + 'px';
        popup.style.left = (rect.left + window.scrollX + rect.width / 2) + 'px';

        // Clamp to viewport edges
        requestAnimationFrame(function () {
            var pr = popup.getBoundingClientRect();
            if (pr.left < 4) popup.style.left = (4 + pr.width / 2) + 'px';
            if (pr.right > window.innerWidth - 4) popup.style.left = (window.innerWidth - 4 - pr.width / 2 + window.scrollX) + 'px';
            if (pr.top < 4) popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
        });

        input.focus();
        input.select();

        function applyEdit() {
            var newReading = input.value.trim();
            if (!newReading) { closeFuriganaEditPopup(); return; }
            rtEl.textContent = newReading;

            // Update stored readings
            var mesEl = ruby.closest('.mes');
            if (mesEl) {
                var mesId = mesEl.getAttribute('mesid');
                try {
                    var readings = JSON.parse(mesEl.dataset.stvFuriganaReadings || '[]');
                    for (var i = 0; i < readings.length; i++) {
                        if (readings[i].word === word && readings[i].reading === currentReading) {
                            readings[i].reading = newReading;
                            break;
                        }
                    }
                    mesEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
                    // Use getCleanText to avoid including ruby readings in hash
                    var editMesText = mesEl.querySelector('.mes_text');
                    saveFuriganaForMessage(mesId, readings, editMesText ? getCleanText(editMesText) : '');
                } catch (_) { }
            }
            closeFuriganaEditPopup();
            toastr.success(word + ' → ' + newReading);
        }

        confirmBtn.addEventListener('click', function (ev) { ev.stopPropagation(); applyEdit(); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); applyEdit(); }
            if (ev.key === 'Escape') { closeFuriganaEditPopup(); }
        });

        // Close on outside click
        setTimeout(function () {
            var closeHandler = function (ev) {
                if (!popup.contains(ev.target)) {
                    closeFuriganaEditPopup();
                    document.removeEventListener('mousedown', closeHandler, true);
                }
            };
            document.addEventListener('mousedown', closeHandler, true);
        }, 0);
    }, true); // useCapture: fires before jQuery/delegated handlers
}

// ── Text Selection → Vocab Add ────────────────────────

function setupTextSelection() {
    var selectionTooltip = null;

    function removeTooltip() {
        if (selectionTooltip) { selectionTooltip.remove(); selectionTooltip = null; }
    }

    function showTooltipForSelection(e) {
        if (selectionTooltip && selectionTooltip.contains(e.target)) return;
        // If furigana edit popup is active, don't show selection tooltip
        if (_furiganaEditActive) return;
        var chatEl = document.getElementById('chat');
        if (!chatEl || !chatEl.contains(e.target)) { removeTooltip(); return; }

        // Small delay for mobile to let selection finalize
        setTimeout(function () {
            // If furigana edit popup was opened by the click handler (fires after mouseup), skip
            if (_furiganaEditActive) return;

            var selection = window.getSelection();
            var selectedText = selection ? selection.toString().trim() : '';
            if (!selectedText || selectedText.length === 0 || selectedText.length > 100) { removeTooltip(); return; }

            // Close furigana edit popup if open — selection tooltip takes priority
            closeFuriganaEditPopup();

            removeTooltip();
            var range = selection.getRangeAt(0);
            var rect = range.getBoundingClientRect();

            selectionTooltip = document.createElement('div');
            selectionTooltip.className = 'stv-selection-tooltip';
            selectionTooltip.innerHTML = '<button class="stv-tooltip-btn stv-tooltip-vocab" title="단어장에 추가"><span class="fa-solid fa-book-bookmark"></span> 단어장에 추가</button>'
                + '<button class="stv-tooltip-btn stv-tooltip-furigana" title="후리가나 달기"><span class="fa-solid fa-language"></span> 후리가나</button>';
            // Capture sentence and word now (selection is a live object that clears on button click)
            var capturedWord = getCleanSelectedText(selection) || selectedText;
            var capturedSentence = extractSentenceFromSelection(selection);

            selectionTooltip.style.top = (rect.top + window.scrollY - 40) + 'px';
            // left will be set after measuring width in rAF
            document.body.appendChild(selectionTooltip);

            // Measure and clamp to viewport
            requestAnimationFrame(function () {
                if (!selectionTooltip) return;
                var tw = selectionTooltip.offsetWidth;
                // Center tooltip on selection, then clamp
                var centerX = rect.left + window.scrollX + (rect.width / 2);
                var left = centerX - (tw / 2);
                // Clamp left edge
                if (left < 4 + window.scrollX) left = 4 + window.scrollX;
                // Clamp right edge
                if (left + tw > window.scrollX + window.innerWidth - 4) {
                    left = window.scrollX + window.innerWidth - 4 - tw;
                }
                selectionTooltip.style.left = left + 'px';

                // Top edge overflow → show below selection instead
                var tr = selectionTooltip.getBoundingClientRect();
                if (tr.top < 4) {
                    selectionTooltip.style.top = (rect.bottom + window.scrollY + 4) + 'px';
                }
            });

            // Vocab add button
            selectionTooltip.querySelector('.stv-tooltip-vocab').addEventListener('click', async function (ev) {
                ev.stopPropagation();
                removeTooltip();
                if (window.getSelection()) window.getSelection().removeAllRanges();
                await showWordDialog(null, { initWord: capturedWord, contextSentence: capturedSentence });
            });

            // Furigana add button
            var savedRange = range.cloneRange();
            selectionTooltip.querySelector('.stv-tooltip-furigana').addEventListener('click', async function (ev) {
                ev.stopPropagation();
                var word = selectedText;
                removeTooltip();
                if (window.getSelection()) window.getSelection().removeAllRanges();

                // Show progress snackbar
                showFuriganaProgressSnackbar('drag', '"' + word + '" 후리가나 생성 중...');

                try {
                    // Get reading from LLM
                    var prompt = 'You are a Japanese reading tool. Give the hiragana reading for this word/phrase.\n'
                        + 'Return ONLY a JSON object: {"word":"' + word + '","reading":"<hiragana reading>"}\n'
                        + 'If the text is already hiragana, return the same text as reading.\n'
                        + 'If the text is katakana, return hiragana equivalent.\n'
                        + 'Word: ' + word + '\nJSON:';
                    var resp = await callLLM(prompt);
                    var match = resp.match(/\{[\s\S]*?\}/);
                    if (!match) { hideFuriganaProgressSnackbar(); toastr.error('후리가나 생성 실패'); return; }
                    var result = JSON.parse(match[0]);
                    if (!result.reading) { hideFuriganaProgressSnackbar(); toastr.error('읽기 정보를 가져올 수 없습니다.'); return; }

                    // Find the text in the message and wrap with ruby
                    var mesTextEl = savedRange.startContainer;
                    while (mesTextEl && !mesTextEl.classList) mesTextEl = mesTextEl.parentNode;
                    var mesEl = mesTextEl ? mesTextEl.closest('.mes') : null;
                    if (!mesEl) { toastr.error('메시지를 찾을 수 없습니다.'); return; }
                    var mesText = mesEl.querySelector('.mes_text');
                    if (!mesText) return;

                    // Store original if not already stored
                    if (!mesText.dataset.stvOriginalHtml) {
                        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                    }

                    // Collect existing readings and add new one
                    var existingReadings = [];
                    try { existingReadings = JSON.parse(mesEl.dataset.stvFuriganaReadings || '[]'); } catch (_) { }
                    // Remove any prior entry for this word (so new reading overrides)
                    existingReadings = existingReadings.filter(function (r) { return r.word !== word; });
                    existingReadings.push({ word: word, reading: result.reading });

                    // Restore original HTML and re-apply all readings together
                    // This ensures the selected word (possibly inside <ruby> from prior generation) is found
                    if (mesText.dataset.stvOriginalHtml) {
                        mesText.innerHTML = mesText.dataset.stvOriginalHtml;
                    }
                    // Capture clean text BEFORE applying furigana (for accurate textHash on save)
                    var cleanTextForHash = mesText.textContent;
                    mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                    applyFuriganaToElement(mesText, existingReadings);
                    highlightVocabInElement(mesText);

                    // Mark and persist
                    var mesId = mesEl.getAttribute('mesid');
                    mesEl.dataset.stvFurigana = 'done';
                    mesEl.dataset.stvFuriganaReadings = JSON.stringify(existingReadings);
                    saveFuriganaForMessage(mesId, existingReadings, cleanTextForHash);

                    hideFuriganaProgressSnackbar();
                    toastr.success(word + ' → ' + result.reading);
                } catch (err) {
                    hideFuriganaProgressSnackbar();
                    console.error('[ST-Vocabulary] Drag furigana error:', err);
                    toastr.error('후리가나 생성 실패: ' + err.message);
                }
            });
        }, e.type === 'touchend' ? 300 : 0);
    }

    document.addEventListener('mouseup', showTooltipForSelection);
    document.addEventListener('touchend', showTooltipForSelection);

    document.addEventListener('mousedown', function (e) {
        if (selectionTooltip && !selectionTooltip.contains(e.target)) removeTooltip();
    });
    document.addEventListener('touchstart', function (e) {
        if (selectionTooltip && !selectionTooltip.contains(e.target)) removeTooltip();
    });
    var chatScroll = document.getElementById('chat');
    if (chatScroll) chatScroll.addEventListener('scroll', function () { removeTooltip(); });
}

// ── Per-message furigana button (.extraMesButtons) ────

/**
 * Close any open furigana popup menus
 */
function closeFuriganaPopupMenus() {
    document.querySelectorAll('.stv-furigana-popup').forEach(function (p) { p.remove(); });
}

/**
 * Show a popup menu near a button element
 */
function showFuriganaPopupMenu(btnEl, items) {
    closeFuriganaPopupMenus();
    var popup = document.createElement('div');
    popup.className = 'stv-furigana-popup';
    items.forEach(function (item) {
        var menuBtn = document.createElement('button');
        menuBtn.className = 'stv-furigana-popup-item';
        menuBtn.innerHTML = '<span class="' + item.icon + '"></span> ' + item.label;
        menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeFuriganaPopupMenus();
            item.action();
        });
        popup.appendChild(menuBtn);
    });
    document.body.appendChild(popup);

    // Position near button
    var rect = btnEl.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = (rect.left + window.scrollX + rect.width / 2) + 'px';

    // Clamp to viewport edges
    requestAnimationFrame(function () {
        var pr = popup.getBoundingClientRect();
        if (pr.left < 4) popup.style.left = (4 + pr.width / 2) + 'px';
        if (pr.right > window.innerWidth - 4) popup.style.left = (window.innerWidth - 4 - pr.width / 2 + window.scrollX) + 'px';
    });

    // Close on outside click (delayed to avoid immediate close)
    setTimeout(function () {
        var closeHandler = function (ev) {
            if (!popup.contains(ev.target)) {
                closeFuriganaPopupMenus();
                document.removeEventListener('mousedown', closeHandler, true);
            }
        };
        document.addEventListener('mousedown', closeHandler, true);
    }, 0);
}

/**
 * Regenerate furigana for a message (clear cache + generate fresh)
 */
async function regenerateMsgFurigana(mesId) {
    var messageEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
    if (!messageEl) return;

    // Remove existing furigana DOM
    var mesText = messageEl.querySelector('.mes_text');
    if (mesText && mesText.dataset.stvOriginalHtml) {
        mesText.innerHTML = mesText.dataset.stvOriginalHtml;
        delete mesText.dataset.stvOriginalHtml;
    }

    // Clear LLM cache for this text
    if (mesText) {
        var text = mesText.textContent;
        var key = textHash(text);
        furiganaCache.delete(key);
        furiganaCache.delete(key + '_k'); // katakana variant too
    }

    // Clear stored data
    delete messageEl.dataset.stvFurigana;
    delete messageEl.dataset.stvFuriganaReadings;
    delete messageEl.dataset.stvFuriganaProcessing;
    removeFuriganaForMessage(mesId);

    // Re-generate
    await processMsgFurigana(mesId);
}

/**
 * Hide furigana on a message but keep stored data (can be re-shown)
 */
function hideFuriganaOnMessage(mesId) {
    var messageEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
    if (!messageEl) return;
    var mesText = messageEl.querySelector('.mes_text');
    if (mesText && mesText.dataset.stvOriginalHtml) {
        mesText.innerHTML = mesText.dataset.stvOriginalHtml;
        delete mesText.dataset.stvOriginalHtml;
        // Re-apply vocab highlights on restored original HTML
        highlightVocabInElement(mesText);
    }
    messageEl.dataset.stvFurigana = 'off';
    // Keep stvFuriganaReadings for re-enabling
    var btn = messageEl.querySelector('.stv-furigana-btn');
    if (btn) btn.title = '후리가나';

    // Persist hidden state so it survives chat reload
    var store = getFuriganaStore();
    if (store && store[String(mesId)]) {
        store[String(mesId)].hidden = true;
        saveMetadataDebounced();
    }
}

/**
 * Show (re-enable) furigana on a message from stored data
 */
function showFuriganaOnMessage(mesId) {
    var messageEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
    if (!messageEl) return;
    var readings;
    try { readings = JSON.parse(messageEl.dataset.stvFuriganaReadings || 'null'); } catch (_) { }
    if (!readings || !Array.isArray(readings) || readings.length === 0) {
        // Try from chatMetadata
        var chatData = getFuriganaStore();
        if (chatData) {
            var entry = chatData[String(mesId)];
            if (entry) readings = getStoredReadings(entry);
        }
    }
    if (!readings || readings.length === 0) {
        toastr.info('저장된 후리가나 데이터가 없습니다.');
        return;
    }
    var mesText = messageEl.querySelector('.mes_text');
    if (mesText) {
        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
        applyFuriganaToElement(mesText, readings);
        highlightVocabInElement(mesText);
        messageEl.dataset.stvFurigana = 'done';
        messageEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
        var btn = messageEl.querySelector('.stv-furigana-btn');
        if (btn) btn.title = '후리가나 제거';
        toastr.success('후리가나 재적용 완료');
    }

    // Remove hidden flag from persistent data
    var hideStore = getFuriganaStore();
    if (hideStore && hideStore[String(mesId)]) {
        delete hideStore[String(mesId)].hidden;
        saveMetadataDebounced();
    }
}

function createFuriganaButton(mesBlock) {
    if (mesBlock.find('.stv-furigana-btn').length > 0) return;
    var mesId = mesBlock.attr('mesid');
    var mesText = mesBlock.find('.mes_text').text() || '';
    var s = getSettings();
    if (!hasKanji(mesText) && !(s.showKatakanaFurigana && hasKatakana(mesText))) return;

    var btn = $('<div>')
        .addClass('mes_button stv-furigana-btn fa-solid fa-language interactable')
        .attr({ title: '후리가나', tabindex: '0' });

    btn.on('click', function (e) {
        e.stopPropagation();
        var messageEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
        var hasFurigana = messageEl && (messageEl.dataset.stvFurigana === 'done');
        var isOff = messageEl && (messageEl.dataset.stvFurigana === 'off');

        if (hasFurigana) {
            // Furigana is visible → show menu: 재생성, 끄기, 삭제
            showFuriganaPopupMenu(btn[0], [
                { icon: 'fa-solid fa-rotate', label: '재생성', action: async function () { await regenerateMsgFurigana(mesId); } },
                { icon: 'fa-solid fa-eye-slash', label: '끄기', action: function () { hideFuriganaOnMessage(mesId); toastr.info('후리가나 숨김'); } },
                { icon: 'fa-solid fa-trash', label: '삭제', action: function () { if (messageEl) removeFuriganaFromMessage(messageEl); toastr.info('후리가나 삭제됨'); } },
            ]);
        } else if (isOff) {
            // Furigana was hidden → show menu: 켜기, 재생성
            showFuriganaPopupMenu(btn[0], [
                { icon: 'fa-solid fa-eye', label: '켜기', action: function () { showFuriganaOnMessage(mesId); } },
                { icon: 'fa-solid fa-rotate', label: '재생성', action: async function () { await regenerateMsgFurigana(mesId); } },
            ]);
        } else if (messageEl && messageEl.dataset.stvFuriganaProcessing === 'true') {
            // Currently generating → cancel
            var ctrl = furiganaAbortControllers.get(String(mesId));
            if (ctrl) {
                ctrl.abort();
                furiganaAbortControllers.delete(String(mesId));
            }
        } else {
            // No furigana yet → generate directly
            processMsgFurigana(mesId);
        }
    });

    var extraMesButtons = mesBlock.find('.extraMesButtons');
    if (extraMesButtons.length) extraMesButtons.prepend(btn);
}



function addFuriganaButtonsToAll() {
    var settings = getSettings();
    if (!settings.enabled || !settings.furiganaEnabled) return;
    $('#chat .mes').each(function () {
        var $this = $(this);
        var isUser = $this.attr('is_user') === 'true';
        if (isUser && !settings.showOnUserMsg) return;
        if (!isUser && !settings.showOnBotMsg) return;
        createFuriganaButton($this);
    });
}

// ── Word Data Update Modal ─────────────────────────────

/**
 * Check if a word's wordForms data has quality issues (e.g. readings in parentheses).
 */
function wordFormsHasIssues(w) {
    if (!w.wordForms || typeof w.wordForms !== 'object') return false;
    var groups = Object.keys(w.wordForms);
    for (var i = 0; i < groups.length; i++) {
        var forms = w.wordForms[groups[i]];
        if (!Array.isArray(forms)) continue;
        for (var j = 0; j < forms.length; j++) {
            if (forms[j].word && /[\(\uff08]/.test(forms[j].word)) return true;
        }
    }
    return false;
}

/**
 * Strip parenthetical readings from existing wordForms data in-place.
 */
function cleanWordFormsData(wordForms) {
    if (!wordForms || typeof wordForms !== 'object') return wordForms;
    Object.keys(wordForms).forEach(function (groupKey) {
        var forms = wordForms[groupKey];
        if (!Array.isArray(forms)) return;
        forms.forEach(function (form) {
            if (form.word && typeof form.word === 'string') {
                form.word = form.word.replace(/\s*[\(\uff08][^\)\uff09]*[\)\uff09]\s*$/, '').trim();
            }
        });
    });
    return wordForms;
}

function showWordUpdateModal() {
    var settings = getSettings();
    var vocabList = settings.vocabList;

    if (vocabList.length === 0) {
        toastr.info('단어장이 비어 있습니다.');
        return;
    }

    var overlay = document.createElement('div');
    overlay.id = 'stv-word-update-overlay';
    overlay.className = 'stv-dialog-overlay';

    // Categorize words
    var issueCount = 0;
    var missingCount = 0;

    // Build word list HTML
    var listHtml = '';
    vocabList.forEach(function (w) {
        var langMap = { ja: '일', en: '영', ko: '한', zh: '중' };
        var langLabel = langMap[w.language] || '?';
        var hasWordForms = w.wordFormsChecked || (w.wordForms && typeof w.wordForms === 'object' && Object.keys(w.wordForms).length > 0);
        var hasIssues = wordFormsHasIssues(w);
        var missingNewFields = w.language === 'ja' && (!w.verbGroup && !w.jlptLevel && !w.kanjiBreakdown);
        var needsUpdate = !hasWordForms || hasIssues || missingNewFields;
        if (!hasWordForms) missingCount++;
        if (hasIssues) issueCount++;

        var statusHtml;
        if (hasIssues) {
            statusHtml = '<span class="stv-update-status-warn" title="데이터 품질 문제 (괄호 읽기 포함)">⚠</span>';
        } else if (hasWordForms) {
            statusHtml = '<span class="stv-update-status-ok" title="정상">✓</span>';
        } else {
            statusHtml = '<span class="stv-update-status-miss" title="활용형 데이터 없음">—</span>';
        }

        listHtml += '<label class="stv-update-item' + (needsUpdate ? ' stv-update-needs' : '') + '">'
            + '<input type="checkbox" class="stv-update-check" data-word-id="' + w.id + '"'
            + (needsUpdate ? ' checked' : '') + ' />'
            + '<span class="stv-update-lang">' + langLabel + '</span>'
            + '<span class="stv-update-word">' + escapeHtml(w.word) + '</span>'
            + '<span class="stv-update-meaning">' + escapeHtml((w.meaning || '').split('\n')[0]) + '</span>'
            + statusHtml
            + '</label>';
    });

    overlay.innerHTML = '<div class="stv-dialog stv-word-update-dialog">'
        + '<div class="stv-dialog-header"><h3>단어 데이터 업데이트</h3>'
        + '<button class="stv-dialog-close">&times;</button></div>'
        + '<div class="stv-dialog-body stv-update-body">'
        + '<div class="stv-update-mode-row">'
        + '<label class="stv-update-mode-label"><input type="checkbox" id="stv-update-overwrite" /> 기존 데이터도 덮어쓰기 (전체 재분석)</label>'
        + '</div>'
        + '<div class="stv-update-info">'
        + '<span>전체: <b>' + vocabList.length + '</b>개 단어</span>'
        + '<div class="stv-update-select-actions">'
        + '<button class="stv-btn stv-btn-text" id="stv-update-select-all">전체 선택</button>'
        + '<button class="stv-btn stv-btn-text" id="stv-update-deselect-all">전체 해제</button>'
        + '<button class="stv-btn stv-btn-text" id="stv-update-select-missing">문제만 선택</button>'
        + '</div></div>'
        + '<div class="stv-update-desc">'
        + (issueCount > 0 ? '⚠ 품질 문제 <b>' + issueCount + '</b>개 (활용형에 읽기 포함) ' : '')
        + (missingCount > 0 ? '— 데이터 누락 <b>' + missingCount + '</b>개 ' : '')
        + (issueCount === 0 && missingCount === 0 ? '모든 단어가 정상입니다. 필요시 선택하여 재분석할 수 있습니다.' : '')
        + '<br>✓ 정상 &nbsp; ⚠ 품질 문제 &nbsp; — 누락</div>'
        + '<div class="stv-update-list">' + listHtml + '</div>'
        + '</div>'
        + '<div class="stv-dialog-footer">'
        + '<button class="stv-btn stv-btn-cancel" id="stv-update-close">닫기</button>'
        + '<button class="stv-btn stv-btn-save" id="stv-update-start">업데이트 시작</button>'
        + '</div></div>';

    document.body.appendChild(overlay);

    var closeModal = function () { overlay.remove(); };

    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeModal);
    document.getElementById('stv-update-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    // Select all / deselect all / select missing
    document.getElementById('stv-update-select-all').addEventListener('click', function () {
        overlay.querySelectorAll('.stv-update-check').forEach(function (cb) { cb.checked = true; });
    });
    document.getElementById('stv-update-deselect-all').addEventListener('click', function () {
        overlay.querySelectorAll('.stv-update-check').forEach(function (cb) { cb.checked = false; });
    });
    document.getElementById('stv-update-select-missing').addEventListener('click', function () {
        overlay.querySelectorAll('.stv-update-check').forEach(function (cb) {
            var wordId = cb.getAttribute('data-word-id');
            var w = vocabList.find(function (v) { return v.id === wordId; });
            var hasData = w && (w.wordFormsChecked || (w.wordForms && typeof w.wordForms === 'object' && Object.keys(w.wordForms).length > 0));
            var hasIssues = wordFormsHasIssues(w);
            cb.checked = !hasData || hasIssues;
        });
    });

    // Start update
    document.getElementById('stv-update-start').addEventListener('click', async function () {
        var overwrite = document.getElementById('stv-update-overwrite').checked;
        var selectedIds = [];
        overlay.querySelectorAll('.stv-update-check:checked').forEach(function (cb) {
            selectedIds.push(cb.getAttribute('data-word-id'));
        });

        if (selectedIds.length === 0) {
            toastr.warning('업데이트할 단어를 선택하세요.');
            return;
        }

        // Close the modal and run in snackbar
        overlay.remove();

        // Create snackbar for non-blocking progress
        var existingSnack = document.getElementById('stv-update-snackbar');
        if (existingSnack) existingSnack.remove();

        var snack = document.createElement('div');
        snack.id = 'stv-update-snackbar';
        snack.className = 'stv-update-snackbar';
        snack.innerHTML = '<div class="stv-update-snack-top">'
            + '<span class="stv-update-snack-label"><span class="fa-solid fa-arrows-rotate fa-spin"></span> 단어 업데이트</span>'
            + '<span class="stv-update-snack-count" id="stv-update-snack-count">0 / ' + selectedIds.length + '</span>'
            + '<button class="stv-btn stv-btn-icon stv-update-snack-cancel" id="stv-update-snack-cancel" title="중지"><span class="fa-solid fa-xmark"></span></button>'
            + '</div>'
            + '<div class="stv-update-snack-bar"><div class="stv-update-snack-fill" id="stv-update-snack-fill"></div></div>';
        document.body.appendChild(snack);

        var shouldCancel = false;
        document.getElementById('stv-update-snack-cancel').addEventListener('click', function () {
            shouldCancel = true;
            this.disabled = true;
        });

        var countEl = document.getElementById('stv-update-snack-count');
        var fillEl = document.getElementById('stv-update-snack-fill');
        var total = selectedIds.length;
        var processed = 0;
        var updated = 0;
        var failed = 0;

        for (var i = 0; i < selectedIds.length; i++) {
            if (shouldCancel) break;

            var wordId = selectedIds[i];
            var wordEntry = vocabList.find(function (w) { return w.id === wordId; });
            if (!wordEntry) { processed++; continue; }

            countEl.textContent = (processed + 1) + ' / ' + total;
            fillEl.style.width = ((processed + 1) / total * 100) + '%';

            try {
                var result = await analyzeWordWithLLM(wordEntry.word, wordEntry.language);
                if (result) {
                    if (overwrite) {
                        if (result.wordForms) wordEntry.wordForms = result.wordForms;
                        wordEntry.wordFormsChecked = true;
                        if (result.baseForm !== undefined) wordEntry.baseForm = result.baseForm;
                        if (result.reading) wordEntry.reading = result.reading;
                        if (result.meaning) wordEntry.meaning = result.meaning;
                        if (result.partOfSpeech) wordEntry.partOfSpeech = result.partOfSpeech;
                        if (result.grammarInfo !== undefined) wordEntry.grammarInfo = result.grammarInfo;
                        if (result.examples && result.examples.length > 0) wordEntry.examples = result.examples;
                        if (result.verbGroup !== undefined) wordEntry.verbGroup = result.verbGroup || null;
                        if (result.jlptLevel !== undefined) wordEntry.jlptLevel = result.jlptLevel || null;
                        if (result.kanjiBreakdown !== undefined) wordEntry.kanjiBreakdown = result.kanjiBreakdown || null;
                    } else {
                        var wfMissing = !wordEntry.wordFormsChecked && (!wordEntry.wordForms || (typeof wordEntry.wordForms === 'object' && Object.keys(wordEntry.wordForms).length === 0));
                        var wfBad = wordFormsHasIssues(wordEntry);
                        if (wfMissing || wfBad) {
                            wordEntry.wordForms = result.wordForms || {};
                        }
                        wordEntry.wordFormsChecked = true;
                        if (!wordEntry.baseForm && result.baseForm) wordEntry.baseForm = result.baseForm;
                        if (!wordEntry.reading && result.reading) wordEntry.reading = result.reading;
                        if (!wordEntry.meaning && result.meaning) wordEntry.meaning = result.meaning;
                        if (!wordEntry.partOfSpeech && result.partOfSpeech) wordEntry.partOfSpeech = result.partOfSpeech;
                        if (!wordEntry.grammarInfo && result.grammarInfo) wordEntry.grammarInfo = result.grammarInfo;
                        if ((!wordEntry.examples || wordEntry.examples.length === 0) && result.examples) wordEntry.examples = result.examples;
                        if (!wordEntry.verbGroup && result.verbGroup) wordEntry.verbGroup = result.verbGroup;
                        if (!wordEntry.jlptLevel && result.jlptLevel) wordEntry.jlptLevel = result.jlptLevel;
                        if (!wordEntry.kanjiBreakdown && result.kanjiBreakdown) wordEntry.kanjiBreakdown = result.kanjiBreakdown;
                    }
                    updated++;
                } else {
                    failed++;
                }
            } catch (e) {
                console.error('[' + MODULE_NAME + '] word update error:', e);
                failed++;
            }

            processed++;
            if (processed % 5 === 0) saveSettings();
        }

        // Final save
        saveSettings();

        // Update snackbar to show completion
        var summaryMsg = updated + '개 업데이트';
        if (failed > 0) summaryMsg += ', ' + failed + '개 실패';
        if (shouldCancel) summaryMsg += ' (중지됨)';

        snack.innerHTML = '<div class="stv-update-snack-top">'
            + '<span class="stv-update-snack-label"><span class="fa-solid fa-check"></span> ' + summaryMsg + '</span>'
            + '<button class="stv-btn stv-btn-icon stv-update-snack-cancel" title="닫기"><span class="fa-solid fa-xmark"></span></button>'
            + '</div>';
        snack.querySelector('.stv-update-snack-cancel').addEventListener('click', function () { snack.remove(); });

        // Auto-dismiss after 5 seconds
        setTimeout(function () { if (snack.parentNode) snack.remove(); }, 5000);

        if (typeof buildWordFormsMap === 'function') buildWordFormsMap();
        renderVocabList();
        toastr.success(summaryMsg, '단어 데이터 업데이트');
    });
}

// ── Settings Modal ────────────────────────────────────

function showSettingsModal() {
    var existingOverlay = document.getElementById('stv-settings-overlay');
    if (existingOverlay) existingOverlay.remove();

    var s = getSettings();

    var providerOptions = '';
    var providerKeys = Object.keys(PROVIDERS);
    for (var pi = 0; pi < providerKeys.length; pi++) {
        var pk = providerKeys[pi];
        providerOptions += '<option value="' + pk + '"' + (s.provider === pk ? ' selected' : '') + '>' + PROVIDERS[pk].label + '</option>';
    }

    // Provider models for dropdown — mirrors SillyTavern's own model lists
    var PROVIDER_MODELS = {
        openai: [
            // GPT-5.2
            'gpt-5.2', 'gpt-5.2-2025-12-11', 'gpt-5.2-chat-latest',
            // GPT-5.1
            'gpt-5.1', 'gpt-5.1-2025-11-13', 'gpt-5.1-chat-latest',
            // GPT-5
            'gpt-5', 'gpt-5-2025-08-07', 'gpt-5-chat-latest', 'gpt-5-mini', 'gpt-5-mini-2025-08-07', 'gpt-5-nano', 'gpt-5-nano-2025-08-07',
            // GPT-4o
            'gpt-4o', 'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13', 'chatgpt-4o-latest',
            // GPT-4o mini
            'gpt-4o-mini', 'gpt-4o-mini-2024-07-18',
            // GPT-4.1
            'gpt-4.1', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14', 'gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14',
            // o-series
            'o1', 'o1-2024-12-17', 'o1-mini', 'o1-mini-2024-09-12', 'o1-preview', 'o1-preview-2024-09-12',
            'o3', 'o3-2025-04-16', 'o3-mini', 'o3-mini-2025-01-31',
            'o4-mini', 'o4-mini-2025-04-16',
            // GPT-4.5
            'gpt-4.5-preview', 'gpt-4.5-preview-2025-02-27',
            // GPT-4 Turbo / GPT-4
            'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-1106-preview',
            'gpt-4', 'gpt-4-0613', 'gpt-4-0314',
            // GPT-3.5
            'gpt-3.5-turbo', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-3.5-turbo-instruct',
        ],
        claude: [
            'claude-opus-4-6',
            'claude-opus-4-5', 'claude-opus-4-5-20251101',
            'claude-sonnet-4-6',
            'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929',
            'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
            'claude-opus-4-1', 'claude-opus-4-1-20250805',
            'claude-opus-4-0', 'claude-opus-4-20250514',
            'claude-sonnet-4-0', 'claude-sonnet-4-20250514',
            'claude-3-7-sonnet-latest', 'claude-3-7-sonnet-20250219',
            'claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620',
            'claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229', 'claude-3-haiku-20240307',
        ],
        google: [
            // Gemini 3.x
            'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview',
            'gemini-3-pro-preview', 'gemini-3-pro-image-preview', 'gemini-3-flash-preview',
            // Gemini 2.5
            'gemini-2.5-pro', 'gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-05-06', 'gemini-2.5-pro-preview-03-25',
            'gemini-2.5-flash', 'gemini-2.5-flash-preview-09-2025', 'gemini-2.5-flash-preview-05-20',
            'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-2.5-flash-lite-preview-06-17',
            'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview',
            // Gemini 2.0
            'gemini-2.0-pro-exp-02-05', 'gemini-2.0-pro-exp', 'gemini-exp-1206',
            'gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-2.0-flash-exp-image-generation', 'gemini-2.0-flash-preview-image-generation',
            'gemini-2.0-flash-thinking-exp-01-21', 'gemini-2.0-flash-thinking-exp-1219', 'gemini-2.0-flash-thinking-exp',
            'gemini-2.0-flash-lite-001', 'gemini-2.0-flash-lite-preview-02-05', 'gemini-2.0-flash-lite-preview', 'gemini-2.0-flash-lite',
            // Gemma
            'gemma-3n-e4b-it', 'gemma-3n-e2b-it', 'gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it', 'gemma-3-1b-it',
            // LearnLM
            'learnlm-2.0-flash-experimental',
        ],
        openrouter: [
            'OR_Website',
        ],
        deepseek: [
            'deepseek-chat', 'deepseek-coder', 'deepseek-reasoner',
        ],
        cohere: [
            // Stable
            'command-a-vision-07-2025', 'command-a-03-2025',
            'command-r-plus', 'command-r-plus-08-2024', 'command-r', 'command-r-08-2024', 'command-r7b-12-2024',
            'command', 'command-light',
            'c4ai-aya-vision-32b', 'c4ai-aya-vision-8b',
            'c4ai-aya-expanse-32b', 'c4ai-aya-expanse-8b',
            'c4ai-aya-23', 'c4ai-aya-23-8b',
            // Nightly
            'command-nightly', 'command-light-nightly',
        ],
        mistralai: [
            'mistral-large-latest', 'mistral-large-2411',
            'mistral-medium-latest', 'mistral-medium-2505', 'mistral-medium-2508',
            'mistral-small-latest', 'mistral-small-2503', 'mistral-small-2506',
            'open-mistral-nemo', 'open-mistral-nemo-2407',
            'codestral-latest', 'codestral-2501',
            'pixtral-large-latest', 'pixtral-12b-2409',
            'ministral-8b-latest', 'ministral-3b-latest',
            'open-mixtral-8x22b', 'open-mixtral-8x7b',
        ],
        groq: [
            'qwen/qwen3-32b',
            'deepseek-r1-distill-llama-70b', 'deepseek-r1-distill-qwen-32b', 'deepseek-r1-distill-llama-70b-specdec',
            'gemma2-9b-it',
            'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct',
            'llama-3.3-70b-versatile', 'llama-3.3-70b-specdec',
            'llama-3.1-8b-instant', 'llama-3.1-70b-versatile',
            'llama-3.2-1b-preview', 'llama-3.2-3b-preview', 'llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview',
            'llama3-70b-8192', 'llama3-8b-8192',
            'mistral-saba-24b',
            'mixtral-8x7b-32768',
            'qwen-qwq-32b', 'qwen-2.5-32b',
            'compound-beta', 'compound-beta-mini',
        ],
        xai: [
            'grok-4', 'grok-4-0709', 'grok-4-fast',
            'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast',
            'grok-3-beta',
            'grok-code',
            'grok-2', 'grok-2-mini', 'grok-2-1212', 'grok-2-vision',
            'grok-vision-beta', 'grok-beta',
        ],
        perplexity: [
            'sonar-pro', 'sonar', 'sonar-deep-research',
            'sonar-reasoning-pro', 'sonar-reasoning',
            'r1-1776',
            // Deprecated
            'llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-huge-128k-online',
            'llama-3.1-sonar-small-128k-chat', 'llama-3.1-sonar-large-128k-chat',
        ],
        ai21: [
            // Latest
            'jamba-mini', 'jamba-large',
            // 1.7
            'jamba-1.7-mini', 'jamba-1.7-large',
            // 1.6
            'jamba-1.6-mini', 'jamba-1.6-large',
            // 1.5
            'jamba-1.5-mini', 'jamba-1.5-large',
            // Legacy
            'jamba-instruct-preview',
        ],
        fireworks: [],
        moonshot: [
            'kimi-k2-0711-preview',
            'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'moonshot-v1-auto',
            'kimi-latest',
            'kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview',
            'kimi-k2-thinking', 'kimi-k2-thinking-turbo',
            'kimi-thinking-preview',
            'moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview', 'moonshot-v1-128k-vision-preview',
        ],
        siliconflow: [
            'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-V3.1-Terminus', 'deepseek-ai/DeepSeek-V3.2-Exp',
            'deepseek-ai/DeepSeek-R1',
            'Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen/Qwen3-235B-A22B-Thinking-2507',
            'Qwen/Qwen3-30B-A3B-Instruct-2507', 'Qwen/Qwen3-30B-A3B-Thinking-2507',
            'Qwen/Qwen3-VL-235B-A22B-Instruct', 'Qwen/Qwen3-VL-32B-Instruct', 'Qwen/Qwen3-VL-8B-Instruct',
            'meta-llama/Llama-3.3-70B-Instruct', 'meta-llama/Meta-Llama-3.1-8B-Instruct',
            'moonshotai/Kimi-K2-Instruct', 'moonshotai/Kimi-K2-Instruct-0905', 'moonshotai/Kimi-K2-Thinking',
            'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
            'baidu/ERNIE-4.5-300B-A47B', 'ByteDance-Seed/Seed-OSS-36B-Instruct',
            'inclusionAI/Ling-1T', 'inclusionAI/Ling-flash-2.0', 'inclusionAI/Ring-1T',
            'MiniMaxAI/MiniMax-M1-80k', 'MiniMaxAI/MiniMax-M2',
            'stepfun-ai/step3', 'tencent/Hunyuan-A13B-Instruct',
            'zai-org/GLM-4.6', 'zai-org/GLM-4.5', 'zai-org/GLM-4.5-Air',
            'THUDM/glm-4-9b-chat',
        ],
        vertexai: [
            // Gemini 3.x
            'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview',
            'gemini-3-pro-preview', 'gemini-3-pro-image-preview', 'gemini-3-flash-preview',
            // Gemini 2.5
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview',
            // Gemini 2.0
            'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-exp', 'gemini-2.0-flash-preview-image-generation',
            'gemini-2.0-flash-lite-001',
        ],
        azure_openai: [],
        nanogpt: [],
        electronhub: [],
        chutes: [],
        aimlapi: [],
        pollinations: [],
        cometapi: [],
        zai: [
            'glm-5',
            'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx',
            'glm-4.6', 'glm-4.6v', 'glm-4.6v-flash', 'glm-4.6v-flashx',
            'glm-4.5v', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-x', 'glm-4.5-airx', 'glm-4.5-flash',
            'glm-4-32b-0414-128k',
            'autoglm-phone-multilingual',
        ],
        custom: [],
    };

    var currentProviderModels = PROVIDER_MODELS[s.provider] || [];
    var isCustomModel = currentProviderModels.indexOf(s.model) === -1 && s.model !== '';
    var modelSelectHtml = '<option value="">모델 선택...</option>';
    currentProviderModels.forEach(function (m) {
        modelSelectHtml += '<option value="' + m + '"' + (s.model === m ? ' selected' : '') + '>' + m + '</option>';
    });
    modelSelectHtml += '<option value="__custom__"' + (isCustomModel ? ' selected' : '') + '>직접 입력</option>';

    var autoFuriganaVal = s.autoFurigana || 'off';

    var overlay = document.createElement('div');
    overlay.id = 'stv-settings-overlay';
    overlay.className = 'stv-dialog-overlay';
    overlay.innerHTML = '<div class="stv-dialog stv-settings-dialog">'
        + '<div class="stv-dialog-header"><h3><span class="fa-solid fa-gear"></span> ST Vocabulary 설정</h3>'
        + '<button class="stv-btn stv-btn-icon stv-dialog-close"><span class="fa-solid fa-xmark"></span></button></div>'
        + '<div class="stv-dialog-body">'

        // ── Section 1: 기본 ──
        + '<div class="stv-settings-section"><h4>기본</h4>'
        + '<div class="stv-setting-row"><label>확장 활성화</label>'
        + '<input type="checkbox" id="stv-set-enabled"' + (s.enabled ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>테마</label>'
        + '<select id="stv-set-theme" class="stv-setting-select">'
        + '<option value="auto"' + (s.theme === 'auto' ? ' selected' : '') + '>적응형 (테마)</option>'
        + '<option value="dark"' + (s.theme === 'dark' ? ' selected' : '') + '>다크</option>'
        + '<option value="light"' + (s.theme === 'light' ? ' selected' : '') + '>라이트</option>'
        + '</select></div></div>'

        // ── Section 2: 후리가나 ──
        + '<div class="stv-settings-section"><h4>후리가나</h4>'
        + '<div class="stv-setting-row"><label>후리가나 기능</label>'
        + '<input type="checkbox" id="stv-set-furigana"' + (s.furiganaEnabled ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>자동 생성</label>'
        + '<select id="stv-set-auto-furigana" class="stv-setting-select">'
        + '<option value="off"' + (autoFuriganaVal === 'off' ? ' selected' : '') + '>OFF</option>'
        + '<option value="ai"' + (autoFuriganaVal === 'ai' ? ' selected' : '') + '>AI 메시지만</option>'
        + '<option value="user"' + (autoFuriganaVal === 'user' ? ' selected' : '') + '>유저 메시지만</option>'
        + '<option value="both"' + (autoFuriganaVal === 'both' ? ' selected' : '') + '>둘 다</option>'
        + '</select></div>'
        + '<div class="stv-setting-row"><label>유저 메시지 버튼</label>'
        + '<input type="checkbox" id="stv-set-user"' + (s.showOnUserMsg ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>AI 메시지 버튼</label>'
        + '<input type="checkbox" id="stv-set-bot"' + (s.showOnBotMsg ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>가타카나 후리가나</label>'
        + '<input type="checkbox" id="stv-set-katakana-furigana"' + (s.showKatakanaFurigana ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>클릭 시 후리가나 수정</label>'
        + '<input type="checkbox" id="stv-set-furigana-edit-click"' + (s.furiganaEditOnClick ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row stv-setting-buttons">'
        + '<button id="stv-set-remove-all" class="stv-btn stv-btn-cancel" style="width:100%;justify-content:center;">'
        + '<span class="fa-solid fa-eraser"></span> 후리가나 전체 삭제</button></div></div>'

        // ── Section 3: 스타일 ──
        + '<div class="stv-settings-section"><h4>스타일</h4>'
        + '<div class="stv-setting-row"><label>후리가나 크기</label>'
        + '<div class="stv-range-wrapper">'
        + '<input type="range" id="stv-set-furigana-size" min="0.3" max="1.0" step="0.05" value="' + (s.furiganaSize != null ? s.furiganaSize : 0.55) + '" />'
        + '<span id="stv-furigana-size-label">' + (s.furiganaSize != null ? s.furiganaSize : 0.55) + 'em</span></div></div>'
        + '<div class="stv-setting-row"><label>후리가나 색상</label>'
        + '<div class="stv-range-wrapper">'
        + '<input type="color" id="stv-set-furigana-color" value="' + (s.furiganaColor || '#888888') + '" style="width:36px;height:28px;padding:1px;border:1px solid var(--SmartThemeBorderColor,#444);border-radius:4px;background:transparent;cursor:pointer;" />'
        + '<input type="range" id="stv-set-furigana-opacity" min="0.1" max="1.0" step="0.05" value="' + (s.furiganaOpacity != null ? s.furiganaOpacity : 0.9) + '" style="width:80px;" />'
        + '<span id="stv-furigana-opacity-label">' + Math.round((s.furiganaOpacity != null ? s.furiganaOpacity : 0.9) * 100) + '%</span></div></div>'
        + '<div class="stv-setting-row"><label>단어장 단어 하이라이트</label>'
        + '<input type="checkbox" id="stv-set-highlight"' + (s.highlightVocab ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row stv-setting-sub"><label>활용형도 하이라이트</label>'
        + '<input type="checkbox" id="stv-set-highlight-forms"' + (s.highlightWordForms ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>하이라이트 색상</label>'
        + '<div class="stv-range-wrapper">'
        + '<input type="color" id="stv-set-vocab-color" value="' + (s.vocabHighlightColor || '#6495ED') + '" style="width:36px;height:28px;padding:1px;border:1px solid var(--SmartThemeBorderColor,#444);border-radius:4px;background:transparent;cursor:pointer;" />'
        + '<span style="font-size:12px !important;color:var(--SmartThemeQuoteColor,#aaa);">단어</span></div></div>'
        + '<div class="stv-setting-row"><label>호버 시 단어 하이라이트</label>'
        + '<input type="checkbox" id="stv-set-hover"' + (s.furiganaHover ? ' checked' : '') + ' /></div>'
        + '<div class="stv-setting-row"><label>호버 색상</label>'
        + '<div class="stv-range-wrapper">'
        + '<input type="color" id="stv-set-vocab-hover-color" value="' + (s.vocabHoverColor || '#6495ED') + '" style="width:36px;height:28px;padding:1px;border:1px solid var(--SmartThemeBorderColor,#444);border-radius:4px;background:transparent;cursor:pointer;" />'
        + '<span style="font-size:12px !important;color:var(--SmartThemeQuoteColor,#aaa);">호버</span></div></div></div>'

        // ── Section 4: API 설정 ──
        + '<div class="stv-settings-section"><h4>API 설정</h4>'
        + '<div class="stv-field"><label>프로바이더</label>'
        + '<select id="stv-set-provider">' + providerOptions + '</select></div>'
        + '<div class="stv-field"><label>모델</label>'
        + '<select id="stv-set-model-select">' + modelSelectHtml + '</select>'
        + '<input type="text" id="stv-set-model-custom" value="' + escapeHtml(isCustomModel ? s.model : '') + '" placeholder="모델명 직접 입력" style="margin-top:6px;' + (isCustomModel ? '' : 'display:none;') + '" /></div>'
        + '<small class="stv-context-hint">SillyTavern API 연결 설정에서 해당 프로바이더의 API 키를 미리 등록하세요.</small></div>'

        // ── Section 5: 단어장 ──
        + '<div class="stv-settings-section"><h4>단어장</h4>'
        + (function () {
            var total = s.vocabList.length;
            var langMap = { ja: '일본어', en: '영어', ko: '한국어', zh: '중국어' };
            var counts = {};
            s.vocabList.forEach(function (w) {
                var l = w.language || 'unknown';
                counts[l] = (counts[l] || 0) + 1;
            });
            var html = '<div class="stv-stats-block">';
            html += '<div class="stv-stats-total">저장된 단어 <b>' + total + '</b>개</div>';
            if (total > 0) {
                var langKeys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
                html += '<div class="stv-stats-langs">';
                langKeys.forEach(function (l) {
                    var label = langMap[l] || (l === 'unknown' ? '미분류' : l);
                    html += '<span class="stv-stats-lang-badge">' + label + ' <b>' + counts[l] + '</b></span>';
                });
                html += '</div>';
            }
            html += '</div>';
            html += '<div class="stv-setting-row stv-setting-buttons" style="margin-top:10px;">'
                + '<button id="stv-set-word-update" class="stv-btn stv-btn-save" style="width:100%;justify-content:center;">'
                + '<span class="fa-solid fa-rotate"></span> 단어 데이터 업데이트'
                + '</button></div>';
            html += '<small class="stv-context-hint" style="margin-top:4px;">단어를 선택하여 AI로 재분석 — 활용형, 읽기 등 데이터를 보완하거나 갱신합니다.</small>';
            return html;
        })()
        + '</div>'

        + '</div>'
        + '<div class="stv-dialog-footer"><button class="stv-btn stv-btn-save" id="stv-set-save">저장</button></div></div>';
    document.body.appendChild(overlay);

    var closeModal = function () { overlay.remove(); };
    overlay.querySelector('.stv-dialog-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    // Provider change → update model dropdown
    document.getElementById('stv-set-provider').addEventListener('change', function () {
        var provider = this.value;
        var models = PROVIDER_MODELS[provider] || [];
        var modelSelect = document.getElementById('stv-set-model-select');
        var customInput = document.getElementById('stv-set-model-custom');
        var defModel = DEFAULT_MODELS[provider] || '';
        var html = '<option value="">모델 선택...</option>';
        models.forEach(function (m) {
            html += '<option value="' + m + '"' + (m === defModel ? ' selected' : '') + '>' + m + '</option>';
        });
        html += '<option value="__custom__">직접 입력</option>';
        modelSelect.innerHTML = html;
        customInput.style.display = 'none';
        customInput.value = '';
    });

    // Model select → show/hide custom input
    document.getElementById('stv-set-model-select').addEventListener('change', function () {
        var customInput = document.getElementById('stv-set-model-custom');
        if (this.value === '__custom__') {
            customInput.style.display = '';
            customInput.focus();
        } else {
            customInput.style.display = 'none';
            customInput.value = '';
        }
    });

    // Remove all furigana
    document.getElementById('stv-set-remove-all').addEventListener('click', function () {
        removeAllFurigana();
        toastr.info('후리가나가 삭제되었습니다.');
    });

    // Word data update button
    document.getElementById('stv-set-word-update').addEventListener('click', function () {
        showWordUpdateModal();
    });

    // Furigana size live preview
    document.getElementById('stv-set-furigana-size').addEventListener('input', function () {
        var val = parseFloat(this.value);
        document.getElementById('stv-furigana-size-label').textContent = val + 'em';
        document.documentElement.style.setProperty('--stv-furigana-size', val + 'em');
    });

    // Furigana color + opacity live preview
    document.getElementById('stv-set-furigana-color').addEventListener('input', function () {
        document.documentElement.style.setProperty('--stv-furigana-color', this.value);
    });
    document.getElementById('stv-set-furigana-opacity').addEventListener('input', function () {
        var val = parseFloat(this.value);
        document.getElementById('stv-furigana-opacity-label').textContent = Math.round(val * 100) + '%';
        document.documentElement.style.setProperty('--stv-furigana-opacity', val);
    });

    // Vocab color live preview
    document.getElementById('stv-set-vocab-color').addEventListener('input', function () {
        var orig = getSettings().vocabHighlightColor;
        getSettings().vocabHighlightColor = this.value;
        applyVocabColors();
        getSettings().vocabHighlightColor = orig;
    });
    document.getElementById('stv-set-vocab-hover-color').addEventListener('input', function () {
        var orig = getSettings().vocabHoverColor;
        getSettings().vocabHoverColor = this.value;
        applyVocabColors();
        getSettings().vocabHoverColor = orig;
    });

    // Save
    document.getElementById('stv-set-save').addEventListener('click', function () {
        var settings = getSettings();
        settings.enabled = document.getElementById('stv-set-enabled').checked;
        settings.theme = document.getElementById('stv-set-theme').value;
        settings.furiganaEnabled = document.getElementById('stv-set-furigana').checked;
        settings.autoFurigana = document.getElementById('stv-set-auto-furigana').value;
        settings.showOnUserMsg = document.getElementById('stv-set-user').checked;
        settings.showOnBotMsg = document.getElementById('stv-set-bot').checked;
        settings.showKatakanaFurigana = document.getElementById('stv-set-katakana-furigana').checked;
        settings.furiganaEditOnClick = document.getElementById('stv-set-furigana-edit-click').checked;
        settings.furiganaSize = parseFloat(document.getElementById('stv-set-furigana-size').value) || 0.55;
        settings.furiganaColor = document.getElementById('stv-set-furigana-color').value || '#888888';
        settings.furiganaOpacity = parseFloat(document.getElementById('stv-set-furigana-opacity').value) || 0.9;
        settings.highlightVocab = document.getElementById('stv-set-highlight').checked;
        settings.highlightWordForms = document.getElementById('stv-set-highlight-forms').checked;
        settings.vocabHighlightColor = document.getElementById('stv-set-vocab-color').value || '#6495ED';
        settings.vocabHoverColor = document.getElementById('stv-set-vocab-hover-color').value || '#6495ED';
        settings.furiganaHover = document.getElementById('stv-set-hover').checked;
        settings.provider = document.getElementById('stv-set-provider').value;
        var modelSelect = document.getElementById('stv-set-model-select');
        var customInput = document.getElementById('stv-set-model-custom');
        settings.model = modelSelect.value === '__custom__' ? customInput.value.trim() : modelSelect.value;
        saveSettings();
        updateFuriganaVisibility();
        applyFuriganaColor();
        applyVocabColors();
        applyTheme();
        addFuriganaButtonsToAll();
        toastr.success('설정 저장됨');
        closeModal();
    });
}

// ── Wand Menu Buttons ─────────────────────────────────

function addWandMenuButtons() {
    var menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    if (!document.getElementById('stv-wand-vocab')) {
        var vocabBtn = document.createElement('div');
        vocabBtn.id = 'stv-wand-vocab';
        vocabBtn.className = 'list-group-item flex-container flexGap5';
        vocabBtn.innerHTML = '<div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div><span>단어장</span>';
        vocabBtn.addEventListener('click', function () {
            toggleVocabPanel();
            $('#extensionsMenu').hide();
        });
        menu.appendChild(vocabBtn);
    }

    if (!document.getElementById('stv-wand-settings')) {
        var settingsBtn = document.createElement('div');
        settingsBtn.id = 'stv-wand-settings';
        settingsBtn.className = 'list-group-item flex-container flexGap5';
        settingsBtn.innerHTML = '<div class="fa-solid fa-gear extensionsMenuExtensionButton"></div><span>ST Vocabulary 설정</span>';
        settingsBtn.addEventListener('click', function () {
            showSettingsModal();
            $('#extensionsMenu').hide();
        });
        menu.appendChild(settingsBtn);
    }
}

// ══════════════════════════════════════════════════════
//  EVENT HANDLERS
// ══════════════════════════════════════════════════════

function onMessageRendered(mesId) {
    var settings = getSettings();
    if (!settings.enabled) return;

    var mesBlock = $('#chat .mes[mesid="' + mesId + '"]');
    if (!mesBlock.length) return;
    var mesEl = mesBlock[0];

    // Vocab highlighting (independent of furigana)
    var mesTextEl = mesEl.querySelector('.mes_text');
    if (mesTextEl) highlightVocabInElement(mesTextEl);

    // Furigana handling
    if (!settings.furiganaEnabled) return;
    var isUser = mesBlock.attr('is_user') === 'true';

    // Show manual furigana button based on per-type toggles
    var showButton = (isUser && settings.showOnUserMsg) || (!isUser && settings.showOnBotMsg);
    if (showButton) createFuriganaButton(mesBlock);

    // Re-apply persistent furigana if this message had it
    if (mesEl && mesEl.dataset.stvFurigana !== 'done') {
        {
            var chatData = getFuriganaStore();
            var entry = chatData && chatData[String(mesId)];
            if (entry) {
                // If furigana was hidden before reload, restore 'off' state without applying
                if (entry.hidden) {
                    if (!mesEl.querySelector('.stv-furigana-btn')) createFuriganaButton(mesBlock);
                    var storedReadings = getStoredReadings(entry);
                    if (storedReadings) mesEl.dataset.stvFuriganaReadings = JSON.stringify(storedReadings);
                    mesEl.dataset.stvFurigana = 'off';
                    var btnOff = mesEl.querySelector('.stv-furigana-btn');
                    if (btnOff) btnOff.title = '후리가나';
                } else {
                    var readings = getStoredReadings(entry);
                    var mesText = mesEl.querySelector('.mes_text');
                    if (readings && mesText && !mesText.querySelector('.stv-ruby')) {
                        // Apply furigana whether text hash matches or not.
                        // Even with hash mismatch (e.g., translator's display_text),
                        // applyFuriganaToElement only replaces kanji still present in the text.
                        // Do NOT delete stored data on mismatch — it must survive for original text.
                        if (!mesEl.querySelector('.stv-furigana-btn')) createFuriganaButton(mesBlock);
                        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                        applyFuriganaToElement(mesText, readings);
                        highlightVocabInElement(mesText);
                        mesEl.dataset.stvFurigana = 'done';
                        mesEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
                        var btn = mesEl.querySelector('.stv-furigana-btn');
                        if (btn) btn.title = '후리가나 제거';
                    }
                }
            }
        }
    }

    // Auto-generate furigana for new messages
    var autoMode = settings.autoFurigana || 'off';
    if (autoMode !== 'off' && mesEl.dataset.stvFurigana !== 'done' && mesEl.dataset.stvFurigana !== 'off') {
        var shouldAuto = (autoMode === 'both') ||
            (autoMode === 'ai' && !isUser) ||
            (autoMode === 'user' && isUser);
        if (shouldAuto) {
            if (!mesEl.querySelector('.stv-furigana-btn')) createFuriganaButton(mesBlock);
            (async function () {
                try {
                    var mesText = mesEl.querySelector('.mes_text');
                    if (!mesText) return;
                    var text = mesText.textContent;
                    var hasJap = hasKanji(text) || (settings.showKatakanaFurigana && hasKatakana(text));
                    if (!hasJap) return;
                    if (mesEl.dataset.stvFuriganaProcessing === 'true') return;
                    mesEl.dataset.stvFuriganaProcessing = 'true';
                    var autoAbortCtrl = new AbortController();
                    furiganaAbortControllers.set(String(mesId), autoAbortCtrl);
                    mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                    var btn = mesEl.querySelector('.stv-furigana-btn');
                    if (btn) { btn.classList.add('stv-spinning'); }
                    showFuriganaProgressSnackbar(String(mesId), '자동 후리가나 생성 중...');
                    var readings = await getLLMFurigana(text, autoAbortCtrl.signal);
                    var currentMesText = mesEl.querySelector('.mes_text');
                    if (currentMesText) {
                        applyFuriganaToElement(currentMesText, readings);
                        highlightVocabInElement(currentMesText);
                        mesEl.dataset.stvFurigana = 'done';
                        mesEl.dataset.stvFuriganaReadings = JSON.stringify(readings);
                        saveFuriganaForMessage(mesId, readings, text);
                    }
                    if (btn) { btn.classList.remove('stv-spinning'); btn.title = '후리가나 제거'; }
                    hideFuriganaProgressSnackbar();
                } catch (e) {
                    if (e.name === 'AbortError') {
                        console.log('[ST-Vocabulary] Auto furigana cancelled for mesId:', mesId);
                    } else {
                        console.warn('[ST-Vocabulary] Auto furigana failed:', e.message);
                    }
                    // Restore original HTML on failure/abort
                    var origMesText = mesEl.querySelector('.mes_text');
                    if (origMesText && origMesText.dataset.stvOriginalHtml) {
                        origMesText.innerHTML = origMesText.dataset.stvOriginalHtml;
                        delete origMesText.dataset.stvOriginalHtml;
                    }
                    var btn2 = mesEl.querySelector('.stv-furigana-btn');
                    if (btn2) { btn2.classList.remove('stv-spinning'); btn2.title = '후리가나 생성'; }
                    hideFuriganaProgressSnackbar();
                } finally {
                    delete mesEl.dataset.stvFuriganaProcessing;
                    furiganaAbortControllers.delete(String(mesId));
                }
            })();
        }
    }
}

/**
 * Remove all vocab highlight spans from chat (unwrap them back to text),
 * then re-apply highlights with current vocab list.
 */
function refreshVocabHighlightsInChat() {
    // Remove existing vocab-hl-span elements (unwrap back to text)
    document.querySelectorAll('#chat .mes .mes_text .stv-vocab-hl-span').forEach(function (span) {
        var parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize(); // merge adjacent text nodes
    });
    // Clean up orphaned furigana wrappers that only contain text (no ruby elements)
    // to prevent nesting on repeated refresh cycles
    document.querySelectorAll('#chat .mes .mes_text .stv-furigana-wrapper').forEach(function (wrapper) {
        if (!wrapper.querySelector('.stv-ruby') && !wrapper.querySelector('.stv-vocab-hl-span')) {
            var parent = wrapper.parentNode;
            while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
            parent.removeChild(wrapper);
            parent.normalize();
        }
    });
    // Also remove stv-vocab-highlight and stv-vocab-form from ruby elements (re-evaluate below)
    document.querySelectorAll('#chat .mes .mes_text .stv-ruby.stv-vocab-highlight').forEach(function (ruby) {
        ruby.classList.remove('stv-vocab-highlight');
        ruby.classList.remove('stv-vocab-form');
        ruby.removeAttribute('data-stv-base-id');
    });
    // Re-apply
    highlightAllVocabInChat();
    // Re-apply to ruby elements too
    var settings = getSettings();
    if (settings.highlightVocab && settings.vocabList) {
        var vocabWords = new Set(settings.vocabList.map(function (w) { return w.word; }));
        var formsMapRefresh = settings.highlightWordForms ? buildWordFormsMap() : null;
        document.querySelectorAll('#chat .mes .mes_text .stv-ruby[data-stv-word]').forEach(function (ruby) {
            var rubyWord = ruby.getAttribute('data-stv-word');
            if (vocabWords.has(rubyWord)) {
                ruby.classList.add('stv-vocab-highlight');
            } else if (formsMapRefresh && formsMapRefresh[rubyWord]) {
                ruby.classList.add('stv-vocab-highlight');
                ruby.classList.add('stv-vocab-form');
                ruby.setAttribute('data-stv-base-id', formsMapRefresh[rubyWord].baseWordId);
            }
        });
    }
}

/**
 * Highlight vocab words in all visible chat messages.
 * Runs independently of furigana — works for katakana, hiragana, romaji, etc.
 */
function highlightAllVocabInChat() {
    var settings = getSettings();
    if (!settings.highlightVocab || !settings.vocabList || settings.vocabList.length === 0) return;

    document.querySelectorAll('#chat .mes .mes_text').forEach(function (mesText) {
        // Skip if already has vocab highlights (avoid double processing)
        if (mesText.querySelector('.stv-vocab-hl-span')) return;
        highlightVocabInElement(mesText);
    });
}

function onChatChanged() {
    migrateOldFuriganaData();
    updateFuriganaVisibility();
    setTimeout(function () {
        addFuriganaButtonsToAll();
        reapplyAllStoredFurigana();
        highlightAllVocabInChat();
    }, 500);
    setupFuriganaMutationObserver();
}

/**
 * Auto-migrate old furiganaData (stored in extension_settings) to chatMetadata.
 * Runs once per chat load. If the current chat has data in the legacy
 * settings.furiganaData[chatId], it copies it into chatMetadata.stvFurigana
 * and removes the old entry.
 */
function migrateOldFuriganaData() {
    try {
        var settings = getSettings();
        if (!settings.furiganaData || typeof settings.furiganaData !== 'object') return;
        var chatId = getCurrentChatId();
        if (!chatId) return;
        var oldData = settings.furiganaData[chatId];
        if (!oldData || typeof oldData !== 'object') return;

        // Only migrate if chatMetadata doesn't already have furigana data
        var existing = getFuriganaStore();
        if (existing && Object.keys(existing).length > 0) {
            // chatMetadata already has data — just remove old entry
            delete settings.furiganaData[chatId];
            if (Object.keys(settings.furiganaData).length === 0) delete settings.furiganaData;
            saveSettings();
            return;
        }

        // Copy old data into chatMetadata
        var store = ensureFuriganaStore();
        if (!store) return;
        Object.keys(oldData).forEach(function (mesId) {
            var entry = oldData[mesId];
            // Normalize old format (direct array) to new format
            if (Array.isArray(entry)) {
                store[mesId] = { readings: entry, textHash: '' };
            } else {
                store[mesId] = entry;
            }
        });
        saveMetadataDebounced();

        // Remove from old storage
        delete settings.furiganaData[chatId];
        if (Object.keys(settings.furiganaData).length === 0) delete settings.furiganaData;
        saveSettings();
        console.log('[' + MODULE_NAME + '] Migrated furigana data for chat: ' + chatId);
    } catch (e) {
        console.warn('[' + MODULE_NAME + '] Failed to migrate old furigana data:', e);
    }
}

/** When a message is edited or swiped, clear its furigana data. */
function onMessageEdited(mesId) {
    if (mesId == null) return;
    var mesEl = document.querySelector('#chat .mes[mesid="' + mesId + '"]');
    if (mesEl && (mesEl.dataset.stvFurigana === 'done' || mesEl.dataset.stvFurigana === 'off')) {
        // Clear DOM state (handles both visible and hidden furigana)
        delete mesEl.dataset.stvFurigana;
        delete mesEl.dataset.stvFuriganaReadings;
        delete mesEl.dataset.stvFuriganaProcessing;
        var mesText = mesEl.querySelector('.mes_text');
        if (mesText) delete mesText.dataset.stvOriginalHtml;
        var btn = mesEl.querySelector('.stv-furigana-btn');
        if (btn) btn.title = '후리가나 생성';
    }
    // Clear persisted data
    removeFuriganaForMessage(mesId);
}

/** When messages are deleted, clean up orphaned furigana data. */
function onMessageDeleted(newLength) {
    var store = getFuriganaStore();
    if (!store) return;
    // Remove furigana entries for mesIds >= newLength
    var changed = false;
    Object.keys(store).forEach(function (mesId) {
        if (parseInt(mesId, 10) >= newLength) {
            delete store[mesId];
            changed = true;
        }
    });
    if (changed) {
        saveMetadataDebounced();
    }
}

/**
 * MutationObserver: watch for mes_text content being replaced.
 * If text changed (hash mismatch) → delete furigana data.
 * If same text just re-rendered → re-apply from cached readings.
 */
var furiganaObserver = null;
function setupFuriganaMutationObserver() {
    if (furiganaObserver) furiganaObserver.disconnect();

    var chat = document.getElementById('chat');
    if (!chat) return;

    furiganaObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

            var target = mutation.target;
            var mesEl = null;
            if (target.classList && target.classList.contains('mes_text')) {
                mesEl = target.closest('.mes');
            } else if (target.classList && target.classList.contains('mes')) {
                mesEl = target;
            } else {
                var node = target;
                while (node && node !== chat) {
                    if (node.classList && node.classList.contains('mes')) { mesEl = node; break; }
                    node = node.parentNode;
                }
            }

            if (!mesEl) continue;
            if (mesEl.dataset.stvFurigana !== 'done') continue;
            if (mesEl.dataset.stvFuriganaProcessing === 'true') continue;

            var mesText = mesEl.querySelector('.mes_text');
            if (!mesText) continue;
            if (mesText.querySelector('.stv-ruby')) continue; // furigana still present

            // Content was replaced — check if text actually changed
            var readingsStr = mesEl.dataset.stvFuriganaReadings;
            if (readingsStr) {
                try {
                    var readings = JSON.parse(readingsStr);
                    var currentText = mesText.textContent || '';
                    var mesId = mesEl.getAttribute('mesid');

                    // Compare with stored hash
                    var storedHash = '';
                    var fStore = getFuriganaStore();
                    if (fStore) {
                        var entry = fStore[String(mesId)];
                        storedHash = getStoredTextHash(entry);
                    }

                    // Set processing flag to prevent re-entrancy from our own DOM changes
                    mesEl.dataset.stvFuriganaProcessing = 'true';

                    if (storedHash && textHash(currentText) !== storedHash) {
                        // Text changed (e.g., LLM translation replaced content)
                        // Try to reapply readings — applyFuriganaToElement only matches kanji still present
                        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                        applyFuriganaToElement(mesText, readings);
                        highlightVocabInElement(mesText);
                        // Do NOT update stored textHash here — keep the original text's hash.
                        // This preserves correct hash comparison when original text is restored
                        // (e.g., translator switches back or message re-renders).
                    } else {
                        // Same text, just re-rendered — re-apply
                        mesText.dataset.stvOriginalHtml = mesText.innerHTML;
                        applyFuriganaToElement(mesText, readings);
                        highlightVocabInElement(mesText);
                    }

                    delete mesEl.dataset.stvFuriganaProcessing;
                } catch (e) {
                    delete mesEl.dataset.stvFuriganaProcessing;
                    console.warn('[' + MODULE_NAME + '] Failed to handle furigana mutation:', e);
                }
            }
        }
    });

    furiganaObserver.observe(chat, { childList: true, subtree: true });
}

// ══════════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════════

jQuery(async function () {
    var settings = getSettings();
    console.log('[' + MODULE_NAME + '] Initializing... (' + settings.vocabList.length + ' words in vocabulary)');

    createVocabPanel();
    addWandMenuButtons();
    setupTextSelection();
    setupVocabHighlightClickDelegation();
    setupFuriganaEditDelegation();
    updateFuriganaVisibility();
    applyFuriganaColor();
    applyVocabColors();
    applyTheme();
    setupFuriganaMutationObserver();

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageEdited);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);

    setTimeout(function () { addFuriganaButtonsToAll(); }, 500);

    console.log('[' + MODULE_NAME + '] Initialized successfully.');
});
