/**
 * clipboard-listener.js
 * Listens for copy events and sends copied text to background script for history tracking
 */

(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;

    // Listen for copy events
    document.addEventListener('copy', async (event) => {
        try {
            // Get the selected text
            const selectedText = window.getSelection().toString().trim();

            if (selectedText && selectedText.length > 0) {
                // Send to background script to add to history
                ext.runtime.sendMessage({
                    action: 'addToClipboardHistory',
                    text: selectedText
                }).catch(err => {
                    console.error('[ProcessingChecklist-ClipboardListener] Failed to send copied text:', err);
                });
            }
        } catch (error) {
            console.error('[ProcessingChecklist-ClipboardListener] Error handling copy event:', error);
        }
    });

    // Also listen for cut events
    document.addEventListener('cut', async (event) => {
        try {
            // Get the selected text
            const selectedText = window.getSelection().toString().trim();

            if (selectedText && selectedText.length > 0) {
                // Send to background script to add to history
                ext.runtime.sendMessage({
                    action: 'addToClipboardHistory',
                    text: selectedText
                }).catch(err => {
                    console.error('[ProcessingChecklist-ClipboardListener] Failed to send cut text:', err);
                });
            }
        } catch (error) {
            console.error('[ProcessingChecklist-ClipboardListener] Error handling cut event:', error);
        }
    });
})();
