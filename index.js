import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    name1,
    name2,
    characters,
    this_chid,
    getThumbnailUrl,
    user_avatar,
    getUserAvatar,
} from '../../../../script.js';

const MODULE_NAME = 'Xgn';
const EXTENSION_ID = 'third-party/Xgn';

const AVATAR_GROUP_CLASS = 'xgn-avatar-group';
const NAME_GROUP_CLASS = 'xgn-name-group';
const AVATAR_ACTIVE_CLASS = 'xgn-avatar-active';
const NAME_ACTIVE_CLASS = 'xgn-name-active';
const PROCESSED_ATTR = 'data-xgn-signature';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function ensureSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    if (!extension_settings[MODULE_NAME].boundThemes) {
        extension_settings[MODULE_NAME].boundThemes = {};
    }
    return extension_settings[MODULE_NAME];
}

function getBoundThemes() {
    return ensureSettings().boundThemes;
}

// ---------------------------------------------------------------------------
// Theme detection (SillyTavern's "Themes" preset dropdown, #themes)
// ---------------------------------------------------------------------------

function getCurrentThemeName() {
    return $('#themes').val() || '';
}

function getAllThemeNames() {
    const names = [];
    $('#themes option').each(function () {
        const val = $(this).attr('value') ?? $(this).text();
        if (val) {
            names.push(val);
        }
    });
    return names;
}

// ---------------------------------------------------------------------------
// User / Char info
// ---------------------------------------------------------------------------

function getUserInfo() {
    let userName = name1;
    let userAvatarSrc = '';

    try {
        if (user_avatar) {
            userAvatarSrc = getUserAvatar(user_avatar);
        }
    } catch (error) {
        userAvatarSrc = '';
    }

    if (!userAvatarSrc) {
        const $lastUserMes = $('#chat .mes[is_user="true"]').last();
        if ($lastUserMes.length) {
            userAvatarSrc = $lastUserMes.find('.mesAvatarWrapper .avatar img').attr('src') || '';
            const domName = $lastUserMes.find('.mes_block .ch_name .name_text').first().text();
            if (domName) {
                userName = domName;
            }
        }
    }

    return { name: userName, avatar: userAvatarSrc };
}

function getCharInfo() {
    let charName = name2;
    let charAvatarSrc = '';

    const character = characters?.[this_chid];
    if (character?.avatar) {
        charAvatarSrc = getThumbnailUrl('avatar', character.avatar);
    }

    if (!charAvatarSrc) {
        const $lastCharMes = $('#chat .mes[is_user="false"]').last();
        if ($lastCharMes.length) {
            charAvatarSrc = $lastCharMes.find('.mesAvatarWrapper .avatar img').attr('src') || '';
            const domName = $lastCharMes.find('.mes_block .ch_name .name_text').first().text();
            if (domName) {
                charName = domName;
            }
        }
    }

    return { name: charName, avatar: charAvatarSrc };
}

// ---------------------------------------------------------------------------
// DOM helpers for locating the original ST elements (read-only lookups)
// ---------------------------------------------------------------------------

function getAvatarWrapper($mes) {
    let $wrapper = $mes.children('.mesAvatarWrapper');
    if (!$wrapper.length) {
        $wrapper = $mes.find('.mesAvatarWrapper').first();
    }
    return $wrapper;
}

function getNameTextParent($mes) {
    const $nameText = $mes.find('.mes_block .ch_name .name_text').first();
    return $nameText.length ? $nameText.parent() : $();
}

// ---------------------------------------------------------------------------
// Building the new elements (Xgn-only class names, added on top of ST's DOM)
// ---------------------------------------------------------------------------

function buildAvatarGroup(userInfo, charInfo) {
    const $group = $('<div>', { class: AVATAR_GROUP_CLASS });

    const $userAvatar = $('<img>', { class: 'xgn-user-avatar', src: userInfo.avatar, alt: userInfo.name });
    const $charAvatar = $('<img>', { class: 'xgn-char-avatar', src: charInfo.avatar, alt: charInfo.name });

    $userAvatar.on('error', function () { $(this).hide(); });
    $charAvatar.on('error', function () { $(this).hide(); });

    $group.append($userAvatar, $charAvatar);
    return $group;
}

function buildNameGroup(userInfo, charInfo) {
    const $group = $('<div>', { class: NAME_GROUP_CLASS });

    const $userName = $('<span>', { class: 'xgn-user-name', text: userInfo.name });
    const $sep = $('<span>', { class: 'xgn-name-sep', text: '&' });
    const $charName = $('<span>', { class: 'xgn-char-name', text: charInfo.name });

    $group.append($userName, $sep, $charName);
    return $group;
}

// ---------------------------------------------------------------------------
// Per-message processing
// ---------------------------------------------------------------------------

function clearMessage($mes) {
    $mes.find('.' + AVATAR_GROUP_CLASS).remove();
    $mes.find('.' + NAME_GROUP_CLASS).remove();
    getAvatarWrapper($mes).removeClass(AVATAR_ACTIVE_CLASS);
    getNameTextParent($mes).removeClass(NAME_ACTIVE_CLASS);
    $mes.removeAttr(PROCESSED_ATTR);
}

function processMessage(mesEl) {
    const $mes = $(mesEl);
    if (!$mes.hasClass('mes')) {
        return;
    }

    const themeName = getCurrentThemeName();
    const config = getBoundThemes()[themeName];

    // Theme not bound, or bound but both switches off -> keep ST's original look.
    if (!config || (!config.avatarTogether && !config.nameTogether)) {
        if ($mes.attr(PROCESSED_ATTR)) {
            clearMessage($mes);
        }
        return;
    }

    const signature = `${themeName}|${config.avatarTogether ? 1 : 0}|${config.nameTogether ? 1 : 0}`;
    if ($mes.attr(PROCESSED_ATTR) === signature) {
        return; // Already rendered with this exact configuration, avoid duplicates.
    }

    clearMessage($mes);

    const userInfo = getUserInfo();
    const charInfo = getCharInfo();

    if (config.avatarTogether) {
        const $wrapper = getAvatarWrapper($mes);
        if ($wrapper.length) {
            $wrapper.addClass(AVATAR_ACTIVE_CLASS);
            $wrapper.append(buildAvatarGroup(userInfo, charInfo));
        }
    }

    if (config.nameTogether) {
        const $nameParent = getNameTextParent($mes);
        if ($nameParent.length) {
            $nameParent.addClass(NAME_ACTIVE_CLASS);
            $nameParent.append(buildNameGroup(userInfo, charInfo));
        }
    }

    $mes.attr(PROCESSED_ATTR, signature);
}

function reprocessAllMessages() {
    $('#chat .mes').each(function () {
        processMessage(this);
    });
}

// ---------------------------------------------------------------------------
// Watching the chat for new / reloaded messages
// ---------------------------------------------------------------------------

let chatObserver = null;

function startObservingChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
        return;
    }

    if (chatObserver) {
        chatObserver.disconnect();
    }

    chatObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) {
                    return;
                }
                const $node = $(node);
                if ($node.hasClass('mes')) {
                    processMessage(node);
                } else {
                    $node.find('.mes').each(function () {
                        processMessage(this);
                    });
                }
            });
        }
    });

    chatObserver.observe(chatEl, { childList: true });
}

// ---------------------------------------------------------------------------
// Settings panel rendering
// ---------------------------------------------------------------------------

function updateCurrentThemeDisplay() {
    const themeName = getCurrentThemeName();
    const bound = Boolean(getBoundThemes()[themeName]);
    const label = themeName || '(无)';
    $('#xgn_current_theme').text(`当前美化：${label}　${bound ? '[已绑定]' : '[未绑定]'}`);
}

function searchRowTemplate(name) {
    const $row = $('<div>', { class: 'xgn-search-row' }).attr('data-theme', name);
    $row.append($('<span>', { class: 'xgn-theme-name', text: name }));
    $row.append($('<div>', { class: 'menu_button xgn-bind-btn', text: '绑定' }));
    return $row;
}

function boundRowTemplate(name, config) {
    const $row = $('<div>', { class: 'xgn-bound-row' }).attr('data-theme', name);

    const $header = $('<div>', { class: 'xgn-bound-row-header' });
    $header.append($('<span>', { class: 'xgn-theme-name', text: name }));
    $header.append($('<div>', { class: 'menu_button xgn-unbind-btn', title: '解绑' })
        .append($('<i>', { class: 'fa-solid fa-xmark' })));
    $row.append($header);

    const $avatarLabel = $('<label>', { class: 'checkbox_label' });
    const $avatarInput = $('<input>', { type: 'checkbox', class: 'xgn-toggle-avatar' });
    $avatarInput.prop('checked', Boolean(config.avatarTogether));
    $avatarLabel.append($avatarInput, document.createTextNode(' 头像放在一起'));
    $row.append($avatarLabel);

    const $nameLabel = $('<label>', { class: 'checkbox_label' });
    const $nameInput = $('<input>', { type: 'checkbox', class: 'xgn-toggle-name' });
    $nameInput.prop('checked', Boolean(config.nameTogether));
    $nameLabel.append($nameInput, document.createTextNode(' 姓名放在一起'));
    $row.append($nameLabel);

    return $row;
}

function renderBoundList() {
    const boundThemes = getBoundThemes();
    const $list = $('#xgn_bound_list');
    $list.empty();

    const names = Object.keys(boundThemes);
    if (names.length === 0) {
        $list.append($('<div>', { class: 'xgn-empty-hint', text: '尚未绑定任何美化' }));
        return;
    }

    for (const name of names) {
        $list.append(boundRowTemplate(name, boundThemes[name]));
    }
}

function renderSearchResults(query) {
    const boundThemes = getBoundThemes();
    const $results = $('#xgn_search_results');
    $results.empty();

    const q = (query || '').trim().toLowerCase();
    const matches = getAllThemeNames().filter((name) => {
        if (boundThemes[name]) {
            return false;
        }
        return !q || name.toLowerCase().includes(q);
    });

    if (matches.length === 0) {
        $results.append($('<div>', { class: 'xgn-empty-hint', text: '没有找到可绑定的美化' }));
        return;
    }

    for (const name of matches) {
        $results.append(searchRowTemplate(name));
    }
}

function refreshSettingsPanel() {
    renderBoundList();
    renderSearchResults($('#xgn_theme_search').val());
    updateCurrentThemeDisplay();
}

function bindSettingsEvents() {
    $(document).on('input', '#xgn_theme_search', function () {
        renderSearchResults($(this).val());
    });

    $(document).on('click', '#xgn_search_results .xgn-bind-btn', function () {
        const name = $(this).closest('.xgn-search-row').attr('data-theme');
        if (!name) {
            return;
        }
        getBoundThemes()[name] = { avatarTogether: false, nameTogether: false };
        saveSettingsDebounced();
        refreshSettingsPanel();
        reprocessAllMessages();
    });

    $(document).on('click', '#xgn_bound_list .xgn-unbind-btn', function () {
        const name = $(this).closest('.xgn-bound-row').attr('data-theme');
        if (!name) {
            return;
        }
        delete getBoundThemes()[name];
        saveSettingsDebounced();
        refreshSettingsPanel();
        reprocessAllMessages();
    });

    $(document).on('change', '#xgn_bound_list .xgn-toggle-avatar', function () {
        const name = $(this).closest('.xgn-bound-row').attr('data-theme');
        const config = getBoundThemes()[name];
        if (!config) {
            return;
        }
        config.avatarTogether = $(this).prop('checked');
        saveSettingsDebounced();
        reprocessAllMessages();
    });

    $(document).on('change', '#xgn_bound_list .xgn-toggle-name', function () {
        const name = $(this).closest('.xgn-bound-row').attr('data-theme');
        const config = getBoundThemes()[name];
        if (!config) {
            return;
        }
        config.nameTogether = $(this).prop('checked');
        saveSettingsDebounced();
        reprocessAllMessages();
    });

    $(document).on('change', '#themes', function () {
        updateCurrentThemeDisplay();
        reprocessAllMessages();
    });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

jQuery(async () => {
    ensureSettings();

    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_ID, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    bindSettingsEvents();
    refreshSettingsPanel();

    startObservingChat();
    reprocessAllMessages();

    const onChatUpdate = () => {
        updateCurrentThemeDisplay();
        reprocessAllMessages();
    };

    eventSource.on(event_types.CHAT_CHANGED, onChatUpdate);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, onChatUpdate);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onChatUpdate);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onChatUpdate);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatUpdate);
    eventSource.on(event_types.PERSONA_CHANGED, onChatUpdate);
});
