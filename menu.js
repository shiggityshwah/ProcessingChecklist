
(function() {
    "use strict";

    const LOG_PREFIX = "[ProcessingChecklist-Menu]";
    let port = null;

    function init() {
        console.log(LOG_PREFIX, "Menu script loaded.");
        try {
            port = browser.runtime.connect({ name: "menu-port" });
            console.log(LOG_PREFIX, "Successfully connected to background script.");

            document.getElementById('toggle-ui-button').addEventListener('click', () => {
                console.log(LOG_PREFIX, "Toggle UI button clicked.");
                port.postMessage({ action: 'toggleUI' });
            });

            document.getElementById('popout-button').addEventListener('click', () => {
                console.log(LOG_PREFIX, "Open Checklist button clicked.");
                port.postMessage({ action: 'openPopout' });
            });

        } catch (error) {
            console.error(LOG_PREFIX, "Failed to connect to background script:", error);
        }
    }

    init();

})();
