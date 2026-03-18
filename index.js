// ═══════════════════════════════════════════
// INDEX — точка входа расширения
// ═══════════════════════════════════════════

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultSettings } from './config.js';
import { getSettings, getCurrentChatId } from './state.js';
import { initCustomNotifications, showNotification } from './notifications.js';
import { setSyncUI, setUpdatePromptInjection } from './pregnancy.js';
import { updatePromptInjection } from './prompts.js';
import { syncUI, setupUI } from './ui.js';
import { onMessageReceived } from './message-handler.js';

function loadSettings() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = structuredClone(defaultSettings);
        } else {
            const s = extension_settings[extensionName];

            if (s.isPregnant !== undefined && !s.chatPregnancyData) {
                console.log('[Reproductive] Migrating old pregnancy data to per-chat structure...');
                s.chatPregnancyData = {};

                if (s.isPregnant) {
                    const chatId = getCurrentChatId();
                    if (chatId) {
                        s.chatPregnancyData[chatId] = {
                            isPregnant: s.isPregnant,
                            conceptionDate: s.conceptionDate,
                            pregnancyWeeks: s.pregnancyWeeks,
                            rpDate: s.rpDate,
                            fetusCount: s.fetusCount,
                            fetusSex: s.fetusSex,
                            complications: s.complications || [],
                            healthStatus: s.healthStatus || 'normal',
                            lastComplicationCheck: s.lastComplicationCheck
                        };
                    }
                }

                delete s.isPregnant;
                delete s.conceptionDate;
                delete s.pregnancyWeeks;
                delete s.rpDate;
                delete s.fetusCount;
                delete s.fetusSex;
                delete s.complications;
                delete s.healthStatus;
                delete s.lastComplicationCheck;
            }

            // Удаляем устаревшие поля рас
            delete s.racePreset;
            delete s.fertilityModifier;
            delete s.cycleLength;
            delete s.customRaceName;
            delete s.specialTraits;

            for (const key in defaultSettings) {
                if (s[key] === undefined) {
                    s[key] = defaultSettings[key];
                }
            }
        }
        console.log('[Reproductive] Settings loaded:', extension_settings[extensionName]);
    } catch (error) {
        console.error('[Reproductive] Error loading settings:', error);
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
}

jQuery(async () => {
    try {
        console.log('[Reproductive] System Loading...');

        loadSettings();
        console.log('[Reproductive] Settings OK');

        // Связываем circular deps
        setSyncUI(syncUI);
        setUpdatePromptInjection(updatePromptInjection);

        initCustomNotifications();
        console.log('[Reproductive] Notifications OK');

        setupUI();
        console.log('[Reproductive] UI OK');

        updatePromptInjection();
        console.log('[Reproductive] Initial prompt injection OK');

        eventSource.on(event_types.MESSAGE_SENT, () => {
            console.log('[Reproductive] MESSAGE_SENT - refreshing prompt');
            updatePromptInjection();
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        if (event_types.CHAT_CHANGED) { 
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.log('[Reproductive] CHAT_CHANGED - switching to chat-specific data');
                const s = getSettings();
                const chatId = getCurrentChatId();
                console.log('[Reproductive] Current chat ID:', chatId);
                
                s.lastCheckedMessageId = null;

                syncUI();
                updatePromptInjection();
            }); 
        }

        console.log('[Reproductive] System Ready!');

    } catch (error) {
        console.error('[Reproductive] System FATAL ERROR:', error);
    }
});
