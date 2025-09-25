(function() {
    "use strict";

    const DEBUG = false;
    function dbg(...args) { if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-Menu]", ...args); }
    const LOG_PREFIX = "[ProcessingChecklist-Menu]";
    let port = null;

    function init() {
        console.info(LOG_PREFIX, "Menu script loaded.");
        try {
            port = browser.runtime.connect({ name: "menu-port" });
            console.info(LOG_PREFIX, "Successfully connected to background script.");

            port.onDisconnect.addListener(() => {
                console.warn(LOG_PREFIX, "Disconnected from background");
                port = null;
            });

            document.getElementById('toggle-ui-button').addEventListener('click', () => {
                dbg("Toggle UI button clicked.");
                if (port) port.postMessage({ action: 'toggleUI' });
            });

            document.getElementById('popout-button').addEventListener('click', () => {
                dbg("Open Checklist button clicked.");
                if (port) port.postMessage({ action: 'openPopout' });
            });

        } catch (error) {
            console.error(LOG_PREFIX, "Failed to connect to background script:", error);
        }
    }

    init();

})();
