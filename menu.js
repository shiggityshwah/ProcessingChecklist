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

        // Default URL patterns - edit here to add more patterns
        // These should match the patterns in checklist-config.json
        const patterns = ['index.html', 'rapid.slacal.com/Policy'];

        for (const p of patterns) {
            if (url.includes(p)) {
                return true;
            }
        }

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
                    checkbox.checked = result.defaultUIVisible === true; // Default to false if not set
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

                    // Load view mode settings after we have tab ID
                    loadViewModeSettings();
                }
            });

            document.getElementById('toggle-ui-button').addEventListener('click', () => {
                dbg("Toggle UI button clicked.");
                if (port && currentTabId) {
                    port.postMessage({ action: 'toggleUI', tabId: currentTabId });
                }
            });

            document.getElementById('popout-button').addEventListener('click', () => {
                dbg("Pop-up Window button clicked.");
                if (port && currentTabId) {
                    port.postMessage({ action: 'openPopout', tabId: currentTabId });
                }
            });

            document.getElementById('tracking-button').addEventListener('click', () => {
                dbg("Tracking button clicked.");
                if (port) {
                    port.postMessage({ action: 'openTracking' });
                }
            });

            document.getElementById('history-button').addEventListener('click', () => {
                dbg("History button clicked.");
                const url = ext.runtime.getURL('extended-history.html');
                ext.tabs.create({ url });
            });

            document.getElementById('changes-report-button').addEventListener('click', () => {
                dbg("Changes Report button clicked.");
                const url = ext.runtime.getURL('changes-report.html');
                ext.tabs.create({ url });
            });

            document.getElementById('calculator-button').addEventListener('click', () => {
                dbg("Processing Calculator button clicked.");
                const url = ext.runtime.getURL('calculator.html');
                ext.windows.create({
                    url: url,
                    type: 'popup',
                    width: 400,
                    height: 738
                });
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

            // Handle view mode radio buttons
            document.querySelectorAll('input[name="view-mode"]').forEach(radio => {
                radio.addEventListener('change', handleViewModeChange);
            });

            // Handle "Set as default" button
            document.getElementById('set-as-default-button').addEventListener('click', handleSetAsDefaultClick);

        } catch (error) {
            console.error(LOG_PREFIX, "Failed to connect to background script:", error);
        }
    }

    function loadViewModeSettings() {
        if (!currentTabId) return;

        ext.storage.local.get([`viewMode_${currentTabId}`, 'defaultViewMode'], (result) => {
            const currentViewMode = result[`viewMode_${currentTabId}`] || result.defaultViewMode || 'full';
            const defaultViewMode = result.defaultViewMode || 'full';

            // Update radio buttons
            const singleRadio = document.getElementById('view-mode-single');
            const fullRadio = document.getElementById('view-mode-full');

            if (currentViewMode === 'single') {
                singleRadio.checked = true;
            } else {
                fullRadio.checked = true;
            }

            // Update default info text
            updateDefaultInfoText(defaultViewMode);

            dbg("Loaded view mode settings:", { currentViewMode, defaultViewMode });
        });
    }

    function updateDefaultInfoText(defaultViewMode) {
        const defaultInfo = document.getElementById('default-info');
        if (defaultInfo) {
            const modeText = defaultViewMode === 'single' ? 'Single Step View' : 'Full Checklist View';
            defaultInfo.textContent = `Default: ${modeText}`;
        }
    }

    function handleViewModeChange(e) {
        const newMode = e.target.value;
        dbg("View mode changed to:", newMode);

        if (!currentTabId) return;

        // Save to tab-specific storage
        ext.storage.local.set({ [`viewMode_${currentTabId}`]: newMode });

        // Send message to content script and popout to update their displays
        if (port) {
            port.postMessage({ action: 'changeViewMode', tabId: currentTabId, mode: newMode });
        }
    }

    function handleSetAsDefaultClick() {
        if (!currentTabId) return;

        // Get current view mode
        const singleRadio = document.getElementById('view-mode-single');
        const currentMode = singleRadio.checked ? 'single' : 'full';

        // Save current mode as default
        ext.storage.local.set({ defaultViewMode: currentMode }, () => {
            dbg("Set default view mode to:", currentMode);

            // Update the info text
            updateDefaultInfoText(currentMode);

            // Show visual feedback
            const button = document.getElementById('set-as-default-button');
            const originalText = button.textContent;
            button.textContent = '✓ Saved!';
            button.style.background = '#28a745';

            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
            }, 1500);
        });
    }

    init();

})();