(function() {
    "use strict";

    const DEBUG = false;
    function dbg(...args) { if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-Menu]", ...args); }
    const LOG_PREFIX = "[ProcessingChecklist-Menu]";
    let port = null;
    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    let currentTabId = null;

    function isFormPage(url) {
        if (!url) return false;
        // Match local test page (index.html)
        if (url.includes('index.html')) return true;
        // Add production URL patterns here as needed
        // Example: if (url.includes('yourcompany.com/policy')) return true;
        return false;
    }

    function updatePopoutButton(enabled) {
        const popoutButton = document.getElementById('popout-button');
        if (!popoutButton) return;

        if (enabled) {
            popoutButton.disabled = false;
            popoutButton.title = '';
            popoutButton.style.opacity = '1';
            popoutButton.style.cursor = 'pointer';
        } else {
            popoutButton.disabled = true;
            popoutButton.title = 'This button only works on the processing form page';
            popoutButton.style.opacity = '0.5';
            popoutButton.style.cursor = 'not-allowed';
        }
    }

    function init() {
        console.info(LOG_PREFIX, "Menu script loaded.");
        try {
            port = ext.runtime.connect({ name: "menu-port" });
            console.info(LOG_PREFIX, "Successfully connected to background script.");

            port.onDisconnect.addListener(() => {
                console.warn(LOG_PREFIX, "Disconnected from background");
                port = null;
            });

            // Load the default UI visibility setting
            ext.storage.local.get('defaultUIVisible', (result) => {
                const checkbox = document.getElementById('default-ui-visible');
                if (checkbox) {
                    checkbox.checked = result.defaultUIVisible !== false; // Default to true if not set
                }
            });

            // Query current tab to check URL and get tab ID
            ext.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                if (tabs.length > 0) {
                    const currentTab = tabs[0];
                    currentTabId = currentTab.id;
                    const isFormPageActive = isFormPage(currentTab.url);
                    updatePopoutButton(isFormPageActive);

                    // Also update toggle-ui button
                    const toggleButton = document.getElementById('toggle-ui-button');
                    if (toggleButton && !isFormPageActive) {
                        toggleButton.disabled = true;
                        toggleButton.title = 'This button only works on the processing form page';
                        toggleButton.style.opacity = '0.5';
                        toggleButton.style.cursor = 'not-allowed';
                    }
                }
            });

            document.getElementById('toggle-ui-button').addEventListener('click', () => {
                dbg("Toggle UI button clicked.");
                if (port && currentTabId) {
                    port.postMessage({ action: 'toggleUI', tabId: currentTabId });
                }
            });

            document.getElementById('popout-button').addEventListener('click', () => {
                dbg("Open Checklist button clicked.");
                if (port && currentTabId) {
                    port.postMessage({ action: 'openPopout', tabId: currentTabId });
                }
            });

            document.getElementById('reset-button').addEventListener('click', () => {
                dbg("Reset button clicked.");
                if (currentTabId) {
                    ext.storage.local.remove([`checklistState_${currentTabId}`, `uiState_${currentTabId}`]);
                }
            });

            // Handle default UI visibility checkbox
            document.getElementById('default-ui-visible').addEventListener('change', (e) => {
                dbg("Default UI visibility changed:", e.target.checked);
                ext.storage.local.set({ defaultUIVisible: e.target.checked });
            });

        } catch (error) {
            console.error(LOG_PREFIX, "Failed to connect to background script:", error);
        }
    }

    init();

})();