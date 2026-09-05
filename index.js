// Xgn - 头像/姓名合并显示 扩展
// 作用：为不同的"美化"(SillyTavern UI 主题/Theme)单独配置，
//       是否在消息的头像位置/姓名位置额外叠加显示 User + Char 的头像或姓名组合。
// 原则：绝不破坏 ST 原生的消息 DOM 结构，只在原有位置"追加"插件自己的新元素，
//       新元素全部使用 xgn- 前缀的新类名，不复用/污染 ST 原生类名。

import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'Xgn';

// ------------------------------------------------------------------
// 设置读写
// ------------------------------------------------------------------

/**
 * 默认设置结构。
 * themes: {
 *   [themeName]: { enabled: boolean, avatar: boolean, name: boolean }
 * }
 */
function getDefaultSettings() {
    return { themes: {} };
}

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = getDefaultSettings();
    }
    if (!extension_settings[MODULE_NAME].themes || typeof extension_settings[MODULE_NAME].themes !== 'object') {
        extension_settings[MODULE_NAME].themes = {};
    }
    return extension_settings[MODULE_NAME];
}

function getThemeConfig(themeName) {
    if (!themeName) return null;
    const settings = getSettings();
    return settings.themes[themeName] || null;
}

function ensureThemeConfig(themeName) {
    const settings = getSettings();
    if (!settings.themes[themeName]) {
        settings.themes[themeName] = { enabled: false, avatar: false, name: false };
    }
    return settings.themes[themeName];
}

function persist() {
    try {
        saveSettingsDebounced();
    } catch (e) {
        console.warn('[Xgn] saveSettingsDebounced 调用失败', e);
    }
}

// ------------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------------

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * 读取当前正在使用的"美化"(主题)名称。
 * SillyTavern 的 UI 主题选择器为 #themes（用户设置面板中），其 value 即为当前主题名，
 * 与 power_user.theme 保持同步，这里优先直接读取 DOM，保证实时性。
 */
function getCurrentThemeName() {
    const sel = document.getElementById('themes');
    if (sel && sel.value) {
        return sel.value;
    }
    try {
        const ctx = getContext();
        if (ctx?.powerUserSettings?.theme) {
            return ctx.powerUserSettings.theme;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

/**
 * 获取当前所有可选的美化(主题)名称列表，用于设置面板展示。
 */
function getAllThemeNames() {
    const sel = document.getElementById('themes');
    const names = [];
    if (sel) {
        sel.querySelectorAll('option').forEach(opt => {
            const val = opt.value || opt.textContent;
            if (val) names.push(val);
        });
    }
    return names;
}

/**
 * 获取 User 的姓名与头像地址。
 * 姓名直接来自 context.name1（始终准确）。
 * 头像优先从"我的角色(persona)"面板里当前选中项的 DOM 中读取，
 * 因为 user_avatar 这个内部变量并未通过 getContext() 暴露出来；
 * 找不到时退化为从聊天记录里任意一条 User 消息的头像元素中读取。
 */
function getUserInfo() {
    let name = 'User';
    try {
        const ctx = getContext();
        if (ctx?.name1) name = ctx.name1;
    } catch (e) {
        // ignore
    }

    let avatarUrl = '';

    const selectedPersonaImg = document.querySelector('#user_avatar_block .avatar-container.selected .avatar img');
    if (selectedPersonaImg?.getAttribute('src')) {
        avatarUrl = selectedPersonaImg.getAttribute('src');
    }

    if (!avatarUrl) {
        const anyUserMesImg = document.querySelector('#chat .mes[is_user="true"] .mesAvatarWrapper .avatar img');
        if (anyUserMesImg?.getAttribute('src')) {
            avatarUrl = anyUserMesImg.getAttribute('src');
        }
    }

    if (!avatarUrl) {
        avatarUrl = 'img/user-default.png';
    }

    return { name, avatarUrl };
}

/**
 * 获取 Char 的姓名与头像地址。
 * 姓名直接来自 context.name2。
 * 头像优先通过 context.characters[characterId].avatar + context.getThumbnailUrl 生成，
 * (群组聊天等取不到单一角色时) 退化为从聊天记录里任意一条角色消息的头像元素中读取。
 */
function getCharInfo() {
    let name = 'Character';
    let avatarUrl = '';

    try {
        const ctx = getContext();
        if (ctx?.name2) name = ctx.name2;
        const character = ctx?.characters?.[ctx.characterId];
        if (character?.avatar && typeof ctx.getThumbnailUrl === 'function') {
            avatarUrl = ctx.getThumbnailUrl('avatar', character.avatar);
        }
    } catch (e) {
        // ignore
    }

    if (!avatarUrl) {
        const anyCharMesImg = document.querySelector('#chat .mes[is_user="false"][is_system="false"] .mesAvatarWrapper .avatar img');
        if (anyCharMesImg?.getAttribute('src')) {
            avatarUrl = anyCharMesImg.getAttribute('src');
        }
    }

    if (!avatarUrl) {
        avatarUrl = 'img/ai4.png';
    }

    return { name, avatarUrl };
}

// ------------------------------------------------------------------
// 消息元素处理（核心）
// ------------------------------------------------------------------

/**
 * 清理某条消息上由 Xgn 追加的所有元素/标记，恢复为 ST 原生显示状态。
 * 只删除本插件自己创建的节点，绝不触碰 ST 原生结构。
 */
function cleanupMessage(mesEl) {
    mesEl.classList.remove('xgn-avatar-merged', 'xgn-name-merged');
    mesEl.querySelectorAll(':scope > .mesAvatarWrapper > .xgn-avatar-group').forEach(el => el.remove());
    mesEl.querySelectorAll(':scope > .mes_block > .ch_name .xgn-name-group').forEach(el => el.remove());
    delete mesEl.dataset.xgnState;
}

/**
 * 对单条消息元素进行处理：根据当前美化的绑定配置，决定是否追加头像组合/姓名组合。
 * 使用 dataset.xgnState 做幂等标记，避免同一条消息被重复处理/重复插入元素。
 */
function applyToMessage(mesEl) {
    if (!mesEl || !mesEl.classList || !mesEl.classList.contains('mes')) return;

    const themeName = getCurrentThemeName();
    const cfg = getThemeConfig(themeName);

    // 未绑定该美化，或该美化两个开关都关闭 —— 保持 ST 原本效果
    const wantAvatar = !!(cfg && cfg.enabled && cfg.avatar);
    const wantName = !!(cfg && cfg.enabled && cfg.name);

    const stateKey = `${themeName || ''}|${wantAvatar ? 1 : 0}|${wantName ? 1 : 0}`;

    // 已经是目标状态，跳过，防止重复生成元素
    if (mesEl.dataset.xgnState === stateKey) {
        return;
    }

    cleanupMessage(mesEl);

    if (!wantAvatar && !wantName) {
        mesEl.dataset.xgnState = stateKey;
        return;
    }

    const userInfo = getUserInfo();
    const charInfo = getCharInfo();

    if (wantAvatar) {
        const wrapper = mesEl.querySelector(':scope > .mesAvatarWrapper');
        if (wrapper && !wrapper.querySelector(':scope > .xgn-avatar-group')) {
            const group = document.createElement('div');
            group.className = 'xgn-avatar-group';
            group.innerHTML = `
                <div class="xgn-avatar-item xgn-avatar-item-user" title="${escapeHtml(userInfo.name)}">
                    <img class="xgn-avatar-img-user" src="${escapeHtml(userInfo.avatarUrl)}" alt="user avatar">
                </div>
                <div class="xgn-avatar-item xgn-avatar-item-char" title="${escapeHtml(charInfo.name)}">
                    <img class="xgn-avatar-img-char" src="${escapeHtml(charInfo.avatarUrl)}" alt="char avatar">
                </div>`;
            wrapper.appendChild(group);
            mesEl.classList.add('xgn-avatar-merged');
        }
    }

    if (wantName) {
        const chNameBlock = mesEl.querySelector(':scope > .mes_block > .ch_name');
        const nameTextContainer = chNameBlock?.querySelector('.flex-container.alignItemsBaseline') || chNameBlock;
        if (nameTextContainer && !nameTextContainer.querySelector(':scope > .xgn-name-group')) {
            const group = document.createElement('span');
            group.className = 'xgn-name-group';
            group.innerHTML = `
                <span class="xgn-name-item xgn-name-item-user">${escapeHtml(userInfo.name)}</span>
                <span class="xgn-name-sep">&amp;</span>
                <span class="xgn-name-item xgn-name-item-char">${escapeHtml(charInfo.name)}</span>`;
            nameTextContainer.appendChild(group);
            mesEl.classList.add('xgn-name-merged');
        }
    }

    mesEl.dataset.xgnState = stateKey;
}

function applyToAllMessages() {
    document.querySelectorAll('#chat .mes').forEach(applyToMessage);
    updateCurrentThemeLabel();
}

let scheduleTimer = null;
function scheduleApplyAll(delay = 60) {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(() => {
        scheduleTimer = null;
        applyToAllMessages();
    }, delay);
}

// ------------------------------------------------------------------
// 动态监听：新消息 / 切换聊天 / 加载历史消息 / 主题切换
// ------------------------------------------------------------------

function bindRuntimeListeners() {
    // 覆盖已知可能触发消息重渲染 / 增删的事件，事件名不存在时安全跳过
    const candidateEventKeys = [
        'CHAT_CHANGED',
        'MESSAGE_RECEIVED',
        'MESSAGE_SENT',
        'MESSAGE_SWIPED',
        'MESSAGE_EDITED',
        'MESSAGE_DELETED',
        'MORE_MESSAGES_LOADED',
        'USER_MESSAGE_RENDERED',
        'CHARACTER_MESSAGE_RENDERED',
        'GENERATION_ENDED',
    ];

    candidateEventKeys.forEach((key) => {
        const evtName = event_types?.[key];
        if (evtName) {
            eventSource.on(evtName, () => scheduleApplyAll());
        }
    });

    // 兜底：直接监听 #chat 容器的子节点变化(新消息插入/历史消息加载等)
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver((mutations) => {
            let relevant = false;
            for (const m of mutations) {
                if (m.addedNodes && m.addedNodes.length > 0) {
                    relevant = true;
                    break;
                }
            }
            if (relevant) scheduleApplyAll();
        });
        observer.observe(chatEl, { childList: true });
    }

    // 主题切换：用户在设置里直接切换美化下拉框时立即生效
    const themeSel = document.getElementById('themes');
    if (themeSel) {
        themeSel.addEventListener('change', () => scheduleApplyAll(0));
    }
}

// ------------------------------------------------------------------
// 设置面板 UI
// ------------------------------------------------------------------

function buildPanelHtml() {
    return `
    <div id="xgn_settings" class="xgn-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Xgn - 头像/姓名合并显示</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="xgn-desc">
                    为不同的"美化"(UI 主题)分别配置：是否在消息的头像/姓名位置追加显示 User 与 Char 的组合信息。
                    未绑定的美化，或已绑定但两个开关都关闭的美化，均保持酒馆原本显示效果。
                </p>
                <div class="xgn-toolbar flex-container alignItemsCenter">
                    <div id="xgn_refresh_themes" class="menu_button menu_button_icon" title="重新扫描当前可用的美化列表">
                        <i class="fa-solid fa-rotate"></i>
                        <span>刷新美化列表</span>
                    </div>
                    <span class="xgn-current-theme">当前美化：<b id="xgn_current_theme_name">-</b></span>
                </div>
                <div id="xgn_theme_list" class="xgn-theme-list"></div>
                <p class="xgn-hint">提示：勾选左侧"绑定"后，右侧两个子开关才能各自单独启用，两者互不影响。</p>
            </div>
        </div>
    </div>`;
}

function renderThemeRow(themeName) {
    const settings = getSettings();
    const cfg = settings.themes[themeName] || { enabled: false, avatar: false, name: false };
    const row = document.createElement('div');
    row.className = 'xgn-theme-row';
    row.dataset.theme = themeName;
    row.innerHTML = `
        <label class="checkbox_label xgn-bind-label">
            <input type="checkbox" class="xgn-bind-toggle" ${cfg.enabled ? 'checked' : ''}>
            <span class="xgn-theme-name">${escapeHtml(themeName)}</span>
        </label>
        <label class="checkbox_label xgn-sub-toggle">
            <input type="checkbox" class="xgn-avatar-toggle" ${cfg.avatar ? 'checked' : ''} ${cfg.enabled ? '' : 'disabled'}>
            <span>头像放在一起</span>
        </label>
        <label class="checkbox_label xgn-sub-toggle">
            <input type="checkbox" class="xgn-name-toggle" ${cfg.name ? 'checked' : ''} ${cfg.enabled ? '' : 'disabled'}>
            <span>姓名放在一起</span>
        </label>`;
    return row;
}

function renderThemeList() {
    const container = document.getElementById('xgn_theme_list');
    if (!container) return;
    container.innerHTML = '';

    const settings = getSettings();
    const names = getAllThemeNames();

    // 保留已经存过配置、但当前下拉框里暂时看不到的美化名称，避免设置丢失
    const savedNames = Object.keys(settings.themes);
    const allNames = Array.from(new Set([...names, ...savedNames]));

    if (allNames.length === 0) {
        container.innerHTML = '<div class="xgn-empty">未检测到任何美化(主题)，请先在"用户设置-UI 主题"中创建或导入至少一个主题。</div>';
        return;
    }

    allNames.forEach((themeName) => {
        container.appendChild(renderThemeRow(themeName));
    });
}

function updateCurrentThemeLabel() {
    const el = document.getElementById('xgn_current_theme_name');
    if (el) {
        el.textContent = getCurrentThemeName() || '-';
    }
}

function bindPanelEvents() {
    const refreshBtn = document.getElementById('xgn_refresh_themes');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            renderThemeList();
            updateCurrentThemeLabel();
        });
    }

    const listContainer = document.getElementById('xgn_theme_list');
    if (!listContainer) return;

    listContainer.addEventListener('change', (ev) => {
        const target = ev.target;
        const row = target.closest('.xgn-theme-row');
        if (!row) return;
        const themeName = row.dataset.theme;
        const cfg = ensureThemeConfig(themeName);

        if (target.classList.contains('xgn-bind-toggle')) {
            cfg.enabled = target.checked;
            const avatarInput = row.querySelector('.xgn-avatar-toggle');
            const nameInput = row.querySelector('.xgn-name-toggle');
            if (avatarInput) avatarInput.disabled = !cfg.enabled;
            if (nameInput) nameInput.disabled = !cfg.enabled;
        } else if (target.classList.contains('xgn-avatar-toggle')) {
            cfg.avatar = target.checked;
        } else if (target.classList.contains('xgn-name-toggle')) {
            cfg.name = target.checked;
        } else {
            return;
        }

        persist();
        scheduleApplyAll(0);
    });
}

function injectSettingsPanel() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return false;
    if (document.getElementById('xgn_settings')) return true; // 已注入过

    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildPanelHtml();
    host.appendChild(wrapper.firstElementChild);

    renderThemeList();
    bindPanelEvents();
    updateCurrentThemeLabel();
    return true;
}

// ------------------------------------------------------------------
// 初始化
// ------------------------------------------------------------------

function init() {
    getSettings();
    injectSettingsPanel();
    bindRuntimeListeners();
    scheduleApplyAll(0);
}

jQuery(async () => {
    // 等待 ST 主界面模板 (#chat / #extensions_settings2) 就绪
    const tryInit = () => {
        const chatReady = document.getElementById('chat');
        const settingsHostReady = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (chatReady && settingsHostReady) {
            init();
            return true;
        }
        return false;
    };

    if (!tryInit()) {
        const bootObserver = new MutationObserver(() => {
            if (tryInit()) {
                bootObserver.disconnect();
            }
        });
        bootObserver.observe(document.body, { childList: true, subtree: true });
    }

    // 双保险：APP_READY 触发后再执行一次全量刷新
    try {
        eventSource.on(event_types.APP_READY, () => scheduleApplyAll(0));
    } catch (e) {
        // ignore
    }
});
