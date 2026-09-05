import { getContext } from '../../st-context.js';
import { user_avatar } from '../../../script.js';

const EXTENSION_NAME = 'swc-user-char-message-info';

const DEFAULT_SETTINGS = {
    themes: {}
};

let context = null;
let settings = null;

let chatObserver = null;
let themeObserver = null;

let refreshTimer = null;


/* =========================================================
 * 初始化
 * ========================================================= */

export async function init() {
    context = getContext();

    settings = context.extensionSettings[EXTENSION_NAME];

    if (!settings) {
        settings = structuredClone(DEFAULT_SETTINGS);
        context.extensionSettings[EXTENSION_NAME] = settings;
    }

    if (!settings.themes || typeof settings.themes !== 'object') {
        settings.themes = {};
    }

    createSettingsPanel();

    bindThemeWatcher();
    bindChatWatcher();

    refreshSettingsThemes();
    refreshMessages();
}


/* =========================================================
 * 设置面板
 * ========================================================= */

function createSettingsPanel() {
    const container = document.getElementById('extensions_settings');

    if (!container) {
        return;
    }

    if (document.getElementById('swc-settings')) {
        return;
    }

    const wrapper = document.createElement('div');

    wrapper.id = 'swc-settings';
    wrapper.className = 'extension_container';

    wrapper.innerHTML = `
        <div class="inline-drawer">

            <div class="inline-drawer-toggle inline-drawer-header">
                <b>User + Char Message Info</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>

            <div class="inline-drawer-content">

                <div class="swc-settings-description">
                    为不同 UI 美化分别设置 User / Char 信息显示方式。
                </div>

                <div class="swc-theme-toolbar">

                    <select
                        id="swc-theme-select"
                        class="text_pole"
                    ></select>

                    <button
                        id="swc-theme-add"
                        class="menu_button"
                        type="button"
                    >
                        绑定
                    </button>

                </div>

                <div
                    id="swc-theme-list"
                    class="swc-theme-list"
                ></div>

            </div>
        </div>
    `;

    container.appendChild(wrapper);

    bindSettingsEvents();
}


/* =========================================================
 * 设置事件
 * ========================================================= */

function bindSettingsEvents() {
    const themeSelect = document.getElementById('swc-theme-select');
    const addButton = document.getElementById('swc-theme-add');

    if (!themeSelect || !addButton) {
        return;
    }

    addButton.addEventListener('click', () => {
        const themeName = String(themeSelect.value || '').trim();

        if (!themeName) {
            return;
        }

        if (!settings.themes[themeName]) {
            settings.themes[themeName] = {
                avatar: false,
                name: false
            };
        }

        saveSettings();

        renderThemeSettings();
        refreshMessages();
    });
}


/* =========================================================
 * 获取 ST 当前所有美化
 * ========================================================= */

function getAvailableThemes() {
    const select = document.getElementById('themes');

    if (!select) {
        return [];
    }

    return Array.from(select.options)
        .map(option => ({
            value: String(option.value || '').trim(),
            name: String(option.textContent || option.value || '').trim()
        }))
        .filter(theme => theme.value);
}


/* =========================================================
 * 刷新美化选择器
 * ========================================================= */

function refreshSettingsThemes() {
    const select = document.getElementById('swc-theme-select');

    if (!select) {
        return;
    }

    const currentValue = select.value;

    select.innerHTML = '';

    const themes = getAvailableThemes();

    for (const theme of themes) {
        const option = document.createElement('option');

        option.value = theme.value;
        option.textContent = theme.name;

        select.appendChild(option);
    }

    if (themes.some(theme => theme.value === currentValue)) {
        select.value = currentValue;
    }

    renderThemeSettings();
}


/* =========================================================
 * 渲染已经绑定的美化
 * ========================================================= */

function renderThemeSettings() {
    const list = document.getElementById('swc-theme-list');

    if (!list) {
        return;
    }

    list.innerHTML = '';

    const themes = Object.keys(settings.themes);

    if (!themes.length) {
        list.innerHTML = `
            <div class="swc-empty">
                暂未绑定任何美化
            </div>
        `;

        return;
    }

    for (const themeName of themes) {
        const themeSettings = settings.themes[themeName];

        const item = document.createElement('div');

        item.className = 'swc-theme-item';
        item.dataset.theme = themeName;

        item.innerHTML = `
            <div class="swc-theme-header">

                <div class="swc-theme-name">
                    ${escapeHtml(themeName)}
                </div>

                <button
                    type="button"
                    class="menu_button swc-theme-remove"
                >
                    <i class="fa-solid fa-trash-can"></i>
                </button>

            </div>

            <div class="swc-theme-options">

                <label class="checkbox_label">
                    <input
                        type="checkbox"
                        class="swc-avatar-toggle"
                        ${themeSettings.avatar ? 'checked' : ''}
                    >
                    <span>头像放在一起</span>
                </label>

                <label class="checkbox_label">
                    <input
                        type="checkbox"
                        class="swc-name-toggle"
                        ${themeSettings.name ? 'checked' : ''}
                    >
                    <span>姓名放在一起</span>
                </label>

            </div>
        `;

        const avatarToggle = item.querySelector('.swc-avatar-toggle');
        const nameToggle = item.querySelector('.swc-name-toggle');
        const removeButton = item.querySelector('.swc-theme-remove');

        avatarToggle.addEventListener('change', () => {
            settings.themes[themeName].avatar = avatarToggle.checked;

            saveSettings();
            refreshMessages();
        });

        nameToggle.addEventListener('change', () => {
            settings.themes[themeName].name = nameToggle.checked;

            saveSettings();
            refreshMessages();
        });

        removeButton.addEventListener('click', () => {
            delete settings.themes[themeName];

            saveSettings();
            renderThemeSettings();
            refreshMessages();
        });

        list.appendChild(item);
    }
}


/* =========================================================
 * 保存扩展设置
 * ========================================================= */

function saveSettings() {
    if (!context?.saveSettingsDebounced) {
        return;
    }

    context.saveSettingsDebounced();
}


/* =========================================================
 * 当前美化
 * ========================================================= */

function getCurrentTheme() {
    return String(
        context?.powerUserSettings?.theme
        || document.getElementById('themes')?.value
        || ''
    ).trim();
}


/* =========================================================
 * 当前美化的插件配置
 * ========================================================= */

function getCurrentThemeSettings() {
    const themeName = getCurrentTheme();

    if (!themeName) {
        return null;
    }

    return settings.themes[themeName] || null;
}


/* =========================================================
 * 美化监听
 * ========================================================= */

function bindThemeWatcher() {
    const themeSelect = document.getElementById('themes');

    if (themeSelect) {
        themeSelect.addEventListener('change', () => {
            setTimeout(() => {
                refreshSettingsThemes();
                refreshMessages();
            }, 50);
        });
    }

    themeObserver = new MutationObserver(() => {
        refreshSettingsThemes();
    });

    themeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}


/* =========================================================
 * 聊天监听
 * ========================================================= */

function bindChatWatcher() {
    const chat = document.getElementById('chat');

    if (!chat) {
        return;
    }

    chatObserver = new MutationObserver(() => {
        scheduleRefresh();
    });

    chatObserver.observe(chat, {
        childList: true,
        subtree: true
    });
}


/* =========================================================
 * 延迟刷新
 * ========================================================= */

function scheduleRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
        refreshMessages();
    }, 30);
}


/* =========================================================
 * 刷新所有消息
 * ========================================================= */

function refreshMessages() {
    const chat = document.getElementById('chat');

    if (!chat) {
        return;
    }

    const themeSettings = getCurrentThemeSettings();

    /*
     * 当前美化没有绑定：
     * 删除插件自己的节点，然后什么都不做。
     */
    if (!themeSettings) {
        removeAllPluginNodes(chat);
        return;
    }

    const messages = chat.querySelectorAll('.mes');

    messages.forEach(message => {
        processMessage(message, themeSettings);
    });
}


/* =========================================================
 * 处理单条消息
 * ========================================================= */

function processMessage(message, themeSettings) {
    if (!message) {
        return;
    }

    const isUser = message.getAttribute('is_user') === 'true';

    /*
     * 头像
     */

    if (themeSettings.avatar) {
        updateAvatarGroup(message, isUser);
    } else {
        removeAvatarGroup(message);
    }

    /*
     * 姓名
     */

    if (themeSettings.name) {
        updateNameGroup(message, isUser);
    } else {
        removeNameGroup(message);
    }
}


/* =========================================================
 * 头像组合
 * ========================================================= */

function updateAvatarGroup(message, isUser) {
    const avatarWrapper = message.querySelector('.mesAvatarWrapper');

    if (!avatarWrapper) {
        return;
    }

    let group = avatarWrapper.querySelector('.swc-avatar-group');

    if (!group) {
        group = document.createElement('div');
        group.className = 'swc-avatar-group';

        avatarWrapper.appendChild(group);
    }

    group.innerHTML = '';

    /*
     * 原消息头像
     */

    const originalAvatar = avatarWrapper.querySelector(
        ':scope > .avatar'
    );

    if (originalAvatar) {
        group.appendChild(originalAvatar);
    }

    /*
     * 另一方头像
     */

    const otherAvatar = document.createElement('div');

    otherAvatar.className = isUser
        ? 'swc-avatar-char'
        : 'swc-avatar-user';

    const img = document.createElement('img');

    if (isUser) {
        img.src = getCharAvatarForUserMessage();
        img.alt = 'Char';
    } else {
        img.src = getUserAvatarUrl();
        img.alt = 'User';
    }

    otherAvatar.appendChild(img);
    group.appendChild(otherAvatar);
}


/* =========================================================
 * 姓名组合
 * ========================================================= */

function updateNameGroup(message, isUser) {
    const nameText = message.querySelector('.name_text');

    if (!nameText) {
        return;
    }

    const nameContainer = nameText.parentElement;

    if (!nameContainer) {
        return;
    }

    let group = nameContainer.querySelector(
        ':scope > .swc-name-group'
    );

    if (!group) {
        group = document.createElement('span');

        group.className = 'swc-name-group';

        nameContainer.appendChild(group);
    }

    group.innerHTML = '';

    /*
     * ST 原本的名字保留不动。
     */

    const otherName = document.createElement('span');

    otherName.className = isUser
        ? 'swc-name-char'
        : 'swc-name-user';

    otherName.textContent = isUser
        ? getCharNameForUserMessage()
        : getUserName();

    group.appendChild(otherName);
}


/* =========================================================
 * User 名称
 * ========================================================= */

function getUserName() {
    return String(
        context?.name1
        || 'User'
    );
}


/* =========================================================
 * Char 名称
 * ========================================================= */

function getCharNameForUserMessage() {
    const character = getCurrentCharacter();

    if (!character) {
        return String(
            context?.name2
            || 'Char'
        );
    }

    return String(
        character.name
        || context?.name2
        || 'Char'
    );
}


/* =========================================================
 * 当前角色
 * ========================================================= */

function getCurrentCharacter() {
    const characterId = context?.characterId;

    if (
        characterId === undefined ||
        characterId === null
    ) {
        return null;
    }

    return context?.characters?.[characterId] || null;
}


/* =========================================================
 * 当前 Char 头像
 * ========================================================= */

function getCharAvatarForUserMessage() {
    const character = getCurrentCharacter();

    if (!character?.avatar) {
        /*
         * 如果聊天里已经有 Char 消息，
         * 优先直接读取 ST 已经生成好的头像 URL。
         */

        const charMessage = document.querySelector(
            '#chat .mes:not([is_user="true"]) .mesAvatarWrapper .avatar img'
        );

        if (charMessage?.src) {
            return charMessage.src;
        }

        return '';
    }

    const avatar = String(character.avatar);

    if (
        avatar.startsWith('http://') ||
        avatar.startsWith('https://') ||
        avatar.startsWith('data:')
    ) {
        return avatar;
    }

    return `/characters/${encodeURIComponent(avatar)}`;
}


/* =========================================================
 * User 头像
 * ========================================================= */

function getUserAvatarUrl() {
    /*
     * 先读取已经存在的 User 消息头像。
     * 这样可以完全跟随 ST 当前实际使用的头像。
     */

    const userMessage = document.querySelector(
        '#chat .mes[is_user="true"] .mesAvatarWrapper .avatar img'
    );

    if (userMessage?.src) {
        return userMessage.src;
    }

    /*
     * 再尝试 ST 的 User Avatar 区域。
     */

    const personaAvatar = document.querySelector(
        '#user_avatar_block .avatar img'
    );

    if (personaAvatar?.src) {
        return personaAvatar.src;
    }

    /*
     * 最后使用 ST 当前 user_avatar。
     */

    if (user_avatar) {
        const avatar = String(user_avatar);

        if (
            avatar.startsWith('http://') ||
            avatar.startsWith('https://') ||
            avatar.startsWith('data:')
        ) {
            return avatar;
        }

        return `/User Avatars/${encodeURIComponent(avatar)}`;
    }

    return '';
}


/* =========================================================
 * 删除头像组合
 * ========================================================= */

function removeAvatarGroup(message) {
    const group = message.querySelector('.swc-avatar-group');

    if (!group) {
        return;
    }

    const originalAvatar = group.querySelector(':scope > .avatar');

    if (originalAvatar) {
        const avatarWrapper = message.querySelector('.mesAvatarWrapper');

        if (avatarWrapper) {
            avatarWrapper.insertBefore(
                originalAvatar,
                avatarWrapper.firstChild
            );
        }
    }

    group.remove();
}


/* =========================================================
 * 删除姓名组合
 * ========================================================= */

function removeNameGroup(message) {
    const group = message.querySelector('.swc-name-group');

    if (group) {
        group.remove();
    }
}


/* =========================================================
 * 删除所有插件节点
 * ========================================================= */

function removeAllPluginNodes(container) {
    container
        .querySelectorAll('.swc-avatar-group')
        .forEach(group => {
            const message = group.closest('.mes');

            if (message) {
                removeAvatarGroup(message);
            }
        });

    container
        .querySelectorAll('.swc-name-group')
        .forEach(group => {
            group.remove();
        });
}


/* =========================================================
 * HTML 转义
 * ========================================================= */

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}