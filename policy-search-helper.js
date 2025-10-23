/**
 * policy-search-helper.js
 * Auto-fills policy search form with parameters from the transaction details page
 */

(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const LOG_PREFIX = "[ProcessingChecklist-PolicySearch]";

    console.log(LOG_PREFIX, "Policy search helper loaded on URL:", window.location.href);
    console.log(LOG_PREFIX, "jQuery available:", typeof window.jQuery !== 'undefined');
    console.log(LOG_PREFIX, "Kendo available:", typeof window.kendo !== 'undefined');

    // Wait for page to be fully loaded and jQuery/Kendo to be available
    let waitAttempts = 0;
    const MAX_WAIT_ATTEMPTS = 50; // 5 seconds max for initial detection
    const QUICK_CHECK_THRESHOLD = 20; // 2 seconds - if not loaded by then, unlikely to load

    function waitForKendo(callback) {
        waitAttempts++;

        // Check multiple jQuery locations
        const $ = window.jQuery || window.$ || (window.frames && window.frames.jQuery);
        const kendo = window.kendo;

        // Also check if Kendo widgets are initialized on target elements
        const brokerElement = document.querySelector('#Broker');
        const hasKendoInitialized = brokerElement && brokerElement.getAttribute('data-role') === 'combobox';

        if ($ && kendo && hasKendoInitialized) {
            console.log(LOG_PREFIX, "jQuery and Kendo are now available, proceeding with callback");
            window.jQuery = $; // Ensure it's accessible
            callback();
        } else if (waitAttempts >= MAX_WAIT_ATTEMPTS) {
            console.log(LOG_PREFIX, "Timeout waiting for jQuery/Kendo after 5 seconds");
            console.log(LOG_PREFIX, "jQuery:", typeof $, "Kendo:", typeof kendo, "Kendo initialized:", hasKendoInitialized);
            console.log(LOG_PREFIX, "Proceeding with direct input fallback...");
            // Still try to check storage and show notification
            autoFillSearchForm();
        } else if (waitAttempts >= QUICK_CHECK_THRESHOLD) {
            // After 2 seconds, if still no jQuery/Kendo, they're probably not coming
            // Check less frequently to avoid wasting CPU
            if (waitAttempts % 5 === 0) {
                console.log(LOG_PREFIX, `Still waiting (slow check)... Attempt ${waitAttempts}/${MAX_WAIT_ATTEMPTS}`);
            }
            setTimeout(() => waitForKendo(callback), 200); // Check every 200ms instead of 100ms
        } else {
            if (waitAttempts % 10 === 0) {
                console.log(LOG_PREFIX, `Waiting for jQuery/Kendo... Attempt ${waitAttempts}/${MAX_WAIT_ATTEMPTS}`);
            }
            setTimeout(() => waitForKendo(callback), 100);
        }
    }

    /**
     * Fallback: Fill input directly without Kendo
     */
    function fillInputDirectly(selector, value) {
        console.log(LOG_PREFIX, `Attempting direct input fill for ${selector} with value:`, value);

        // Try as CSS selector first (ID or class)
        let element = document.querySelector(selector);

        // If not found and selector looks like #id, try as name attribute
        if (!element && selector.startsWith('#')) {
            const nameValue = selector.substring(1);
            console.log(LOG_PREFIX, `Trying name attribute: ${nameValue}`);
            element = document.querySelector(`[name="${nameValue}"]`);
        }

        if (!element) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return false;
        }

        try {
            console.log(LOG_PREFIX, `Found element:`, element);

            // Check for Kendo widgets
            const dataRole = element.getAttribute('data-role');
            const isKendoComboBox = dataRole === 'combobox';
            const isKendoDropDownList = dataRole === 'dropdownlist';

            if (isKendoComboBox) {
                console.log(LOG_PREFIX, `Detected Kendo ComboBox, filling both hidden and visible inputs`);

                // Fill the hidden input (has the actual value)
                element.value = value;

                // Find and fill the visible input (what user sees)
                const hiddenId = element.id || element.name;
                const visibleInput = document.querySelector(`input[name="${hiddenId}_input"]`);

                if (visibleInput) {
                    console.log(LOG_PREFIX, `Found visible input:`, visibleInput);
                    visibleInput.value = value;

                    // Trigger events on visible input
                    const events = ['input', 'change', 'blur', 'keydown'];
                    events.forEach(eventType => {
                        const event = new Event(eventType, { bubbles: true, cancelable: true });
                        visibleInput.dispatchEvent(event);
                    });
                } else {
                    console.warn(LOG_PREFIX, `Visible input not found for: ${hiddenId}_input`);
                }
            } else if (isKendoDropDownList) {
                console.log(LOG_PREFIX, `Detected Kendo DropDownList, filling hidden input and visible span`);

                const hiddenId = element.id || element.name;

                // Find the listbox to search for matching option
                const listbox = document.querySelector(`#${hiddenId}_listbox`);
                let optionId = null;

                if (listbox) {
                    // Search through options to find matching text
                    const options = listbox.querySelectorAll('li[role="option"]');
                    console.log(LOG_PREFIX, `Found ${options.length} options in dropdown`);

                    for (const option of options) {
                        const optionText = option.textContent.trim();
                        console.log(LOG_PREFIX, `  Checking option: "${optionText}" vs "${value}"`);
                        if (optionText === value) {
                            optionId = option.getAttribute('data-offset-index');
                            console.log(LOG_PREFIX, `  ✓ Match found! Option index: ${optionId}`);
                            break;
                        }
                    }
                } else {
                    console.warn(LOG_PREFIX, `Listbox not found: #${hiddenId}_listbox`);
                }

                // Set the value in the hidden input
                if (optionId !== null) {
                    element.value = optionId;
                    console.log(LOG_PREFIX, `Set hidden input value to: ${optionId}`);
                } else {
                    console.warn(LOG_PREFIX, `Could not find matching option for: ${value}, trying text as value`);
                    element.value = value;
                }

                // Find and update the visible span element that displays the text
                // Try multiple selector strategies for finding the visible element
                let visibleSpan = document.querySelector(`span[aria-owns="${hiddenId}_listbox"] .k-input`);

                if (!visibleSpan) {
                    // Try finding by parent span with aria-owns
                    const parentSpan = document.querySelector(`span[aria-owns="${hiddenId}_listbox"]`);
                    if (parentSpan) {
                        visibleSpan = parentSpan.querySelector('.k-input');
                    }
                }

                if (!visibleSpan) {
                    // Try finding the wrapper and then the span inside it
                    const wrapper = element.parentElement;
                    if (wrapper) {
                        visibleSpan = wrapper.querySelector('.k-dropdown-wrap .k-input');
                    }
                }

                if (visibleSpan) {
                    console.log(LOG_PREFIX, `Found visible span, setting text to: ${value}`);
                    visibleSpan.textContent = value;
                } else {
                    console.warn(LOG_PREFIX, `Visible span not found for DropDownList: ${hiddenId}`);
                }
            } else {
                // Regular input - just set value
                element.value = value;
            }

            // Trigger events on the main element
            const events = ['input', 'change', 'blur'];
            events.forEach(eventType => {
                const event = new Event(eventType, { bubbles: true, cancelable: true });
                element.dispatchEvent(event);
            });

            console.log(LOG_PREFIX, `✓ Directly filled ${selector} with:`, value);
            return true;
        } catch (error) {
            console.error(LOG_PREFIX, `Error directly filling ${selector}:`, error);
            return false;
        }
    }

    /**
     * Fill Kendo ComboBox with value
     */
    function fillKendoComboBox(selector, value, isText = false) {
        console.log(LOG_PREFIX, `fillKendoComboBox called with selector: ${selector}, value:`, value, `isText: ${isText}`);

        // Check if jQuery is available
        if (!window.jQuery) {
            console.warn(LOG_PREFIX, `jQuery not available, trying direct input fill`);
            return fillInputDirectly(selector, value);
        }

        const element = window.jQuery(selector);
        console.log(LOG_PREFIX, `jQuery element found:`, element.length > 0, `Element:`, element);

        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return fillInputDirectly(selector, value);
        }

        const widget = element.data('kendoComboBox');
        console.log(LOG_PREFIX, `Kendo ComboBox widget:`, widget);

        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo ComboBox widget not found for: ${selector}`);
            // List all available data attributes to help debug
            const allData = element.data();
            console.log(LOG_PREFIX, `Available data attributes on element:`, allData);
            // Try direct fill as fallback
            console.log(LOG_PREFIX, `Falling back to direct input fill`);
            return fillInputDirectly(selector, value);
        }

        try {
            console.log(LOG_PREFIX, `Widget state before fill - value:`, widget.value(), `text:`, widget.text());

            if (isText) {
                // For text input (like insurer name), just set the text
                console.log(LOG_PREFIX, `Setting text to:`, value);
                widget.text(value);
                widget.trigger('change');
            } else {
                // For ID value, set the value
                console.log(LOG_PREFIX, `Setting value to:`, value);
                widget.value(value);
                widget.trigger('change');
            }

            console.log(LOG_PREFIX, `Widget state after fill - value:`, widget.value(), `text:`, widget.text());
            console.log(LOG_PREFIX, `✓ Successfully filled ${selector} with:`, value);
            return true;
        } catch (error) {
            console.error(LOG_PREFIX, `Error filling ${selector}:`, error);
            console.error(LOG_PREFIX, `Error stack:`, error.stack);
            // Try direct fill as last resort
            console.log(LOG_PREFIX, `Attempting direct fill as last resort`);
            return fillInputDirectly(selector, value);
        }
    }

    /**
     * Fill Kendo DatePicker with date
     */
    function fillKendoDatePicker(selector, dateString) {
        console.log(LOG_PREFIX, `fillKendoDatePicker called with selector: ${selector}, dateString:`, dateString);

        // Check if jQuery is available
        if (!window.jQuery) {
            console.warn(LOG_PREFIX, `jQuery not available, trying direct input fill`);
            return fillInputDirectly(selector, dateString);
        }

        const element = window.jQuery(selector);
        console.log(LOG_PREFIX, `jQuery element found:`, element.length > 0, `Element:`, element);

        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return fillInputDirectly(selector, dateString);
        }

        const widget = element.data('kendoDatePicker');
        console.log(LOG_PREFIX, `Kendo DatePicker widget:`, widget);

        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo DatePicker widget not found for: ${selector}`);
            // List all available data attributes to help debug
            const allData = element.data();
            console.log(LOG_PREFIX, `Available data attributes on element:`, allData);
            // Try direct fill as fallback
            console.log(LOG_PREFIX, `Falling back to direct input fill`);
            return fillInputDirectly(selector, dateString);
        }

        try {
            console.log(LOG_PREFIX, `Widget state before fill - value:`, widget.value());

            // Parse MM/DD/YYYY format
            const parts = dateString.split('/');
            const date = new Date(parts[2], parts[0] - 1, parts[1]);
            console.log(LOG_PREFIX, `Parsed date object:`, date);

            widget.value(date);
            widget.trigger('change');

            console.log(LOG_PREFIX, `Widget state after fill - value:`, widget.value());
            console.log(LOG_PREFIX, `✓ Successfully filled ${selector} with:`, dateString);
            return true;
        } catch (error) {
            console.error(LOG_PREFIX, `Error filling ${selector}:`, error);
            console.error(LOG_PREFIX, `Error stack:`, error.stack);
            // Try direct fill as last resort
            console.log(LOG_PREFIX, `Attempting direct fill as last resort`);
            return fillInputDirectly(selector, dateString);
        }
    }

    /**
     * Auto-fill search form with pending parameters
     */
    function autoFillSearchForm() {
        console.log(LOG_PREFIX, "autoFillSearchForm called, checking storage...");

        // Check for both policy search and transaction search parameters
        ext.storage.local.get(['pendingPolicySearch', 'pendingTransactionSearch'], (result) => {
            console.log(LOG_PREFIX, "Storage result:", result);

            // Prefer transaction search if available, otherwise fall back to policy search
            let params = result.pendingTransactionSearch || result.pendingPolicySearch;
            let storageKey = result.pendingTransactionSearch ? 'pendingTransactionSearch' : 'pendingPolicySearch';

            if (!params) {
                console.log(LOG_PREFIX, "No pending search parameters found in storage");
                return;
            }

            console.log(LOG_PREFIX, "Found params:", params, "from key:", storageKey);

            // Check if parameters are recent (within last 5 minutes)
            const age = Date.now() - params.timestamp;
            console.log(LOG_PREFIX, "Parameter age (ms):", age, "Max allowed:", 5 * 60 * 1000);

            if (age > 5 * 60 * 1000) {
                console.log(LOG_PREFIX, "Pending search parameters are too old, ignoring");
                ext.storage.local.remove(storageKey);
                return;
            }

            console.log(LOG_PREFIX, "Parameters are recent, showing confirmation dialog");

            // Show confirmation notification
            showAutoFillConfirmation(params);
        });
    }

    /**
     * Show confirmation notification for auto-fill
     */
    function showAutoFillConfirmation(params) {
        console.log(LOG_PREFIX, "showAutoFillConfirmation called with params:", params);

        // Ensure body is available
        if (!document.body) {
            console.warn(LOG_PREFIX, "document.body not available yet, waiting...");
            setTimeout(() => showAutoFillConfirmation(params), 100);
            return;
        }

        const notification = document.createElement('div');
        notification.id = 'auto-fill-confirmation';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #5cb85c;
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 400px;
        `;

        // Check if we have jQuery/Kendo for auto-fill (but we now have fallback anyway)
        const hasKendo = typeof window.jQuery !== 'undefined' && typeof window.kendo !== 'undefined';
        console.log(LOG_PREFIX, "hasKendo:", hasKendo);

        // We'll always show the Fill Form button now since we have a direct input fallback
        const canAutoFill = true;

        // Create properly formatted insurer name with all details
        // Format: [SLA#] INSURER NAME (#NAIC#) - STATUS
        let insurerDisplay = params.insurerName;
        if (params.slaNumber && params.insurerName && params.naicNumber) {
            insurerDisplay = `[${params.slaNumber}] ${params.insurerName} (#${params.naicNumber})`;
            if (params.insurerStatus) {
                insurerDisplay += ` - ${params.insurerStatus}`;
            }
        } else if (params.insurerId && params.insurerName) {
            // Fallback format if we only have insurer ID
            insurerDisplay = `[${params.insurerId}] ${params.insurerName} (#${params.insurerId})`;
        }

        let html = '<div style="font-weight: bold; margin-bottom: 10px;">🔍 Search Parameters Ready!</div>';
        html += '<div style="font-size: 12px; margin-bottom: 10px; opacity: 0.9;">Click any value to copy</div>';

        if (params.brokerId) {
            html += `<div class="copy-field" data-value="${params.brokerId}" style="margin-bottom: 5px; padding: 6px; background: rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">`;
            html += `<span style="opacity: 0.8;">Broker:</span> <strong>${params.brokerId}</strong>`;
            html += `</div>`;
        }

        if (insurerDisplay) {
            html += `<div class="copy-field" data-value="${insurerDisplay}" style="margin-bottom: 5px; padding: 6px; background: rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">`;
            html += `<span style="opacity: 0.8;">Insurer:</span> <strong style="font-size: 11px;">${insurerDisplay}</strong>`;
            html += `</div>`;
        }

        html += `<div class="copy-field" data-value="${params.dateFrom}" style="margin-bottom: 5px; padding: 6px; background: rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; transition: background 0.2s; display: inline-block; width: 48%; margin-right: 4%;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">`;
        html += `<span style="opacity: 0.8;">From:</span> <strong>${params.dateFrom}</strong>`;
        html += `</div>`;

        html += `<div class="copy-field" data-value="${params.dateTo}" style="margin-bottom: 5px; padding: 6px; background: rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; transition: background 0.2s; display: inline-block; width: 48%;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">`;
        html += `<span style="opacity: 0.8;">To:</span> <strong>${params.dateTo}</strong>`;
        html += `</div>`;

        // Always show Fill Form button with fallback support
        html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; gap: 8px;">';
        html += '<button id="autoFillYesBtn" style="flex: 1; background: white; color: #5cb85c; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Fill Form</button>';
        html += '<button id="autoFillNoBtn" style="flex: 1; background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Dismiss</button>';
        html += '</div>';

        if (!hasKendo) {
            html += '<div style="margin-top: 8px; font-size: 11px; opacity: 0.8; font-style: italic;">Note: Using direct input method</div>';
        }

        notification.innerHTML = html;
        console.log(LOG_PREFIX, "Appending notification to document.body");
        document.body.appendChild(notification);
        console.log(LOG_PREFIX, "Notification appended successfully. Element:", notification);

        // Add click-to-copy functionality for all copy-field elements
        const copyFields = notification.querySelectorAll('.copy-field');
        copyFields.forEach(field => {
            field.addEventListener('click', () => {
                const value = field.getAttribute('data-value');
                navigator.clipboard.writeText(value).then(() => {
                    // Show temporary "Copied!" feedback
                    const originalHTML = field.innerHTML;
                    field.innerHTML = '<span style="color: #fff;">✓ Copied!</span>';
                    field.style.background = 'rgba(255,255,255,0.3)';

                    setTimeout(() => {
                        field.innerHTML = originalHTML;
                        field.style.background = 'rgba(255,255,255,0.1)';
                    }, 1000);
                }).catch(err => {
                    console.error(LOG_PREFIX, 'Failed to copy to clipboard:', err);
                });
            });
        });

        // Yes button - perform auto-fill (works with or without Kendo via fallback)
        const yesBtn = document.getElementById('autoFillYesBtn');
        if (yesBtn) {
            yesBtn.addEventListener('click', () => {
                notification.remove();
                performAutoFill(params);
            });
        }

        // No button - dismiss
        const noBtn = document.getElementById('autoFillNoBtn');
        if (noBtn) {
            noBtn.addEventListener('click', () => {
                notification.remove();
                ext.storage.local.remove('pendingPolicySearch');
            });
        }

        // Notification is now persistent - user must dismiss manually
        // (No auto-dismiss timeout)
    }

    /**
     * Debug function to list all Kendo widgets on the page
     */
    function debugListKendoWidgets() {
        console.log(LOG_PREFIX, "\n🔍 DEBUGGING: Scanning page for Kendo widgets...");

        const $ = window.jQuery;
        if (!$) {
            console.log(LOG_PREFIX, "jQuery not available");
            return;
        }

        // Find all elements with Kendo widgets
        const widgets = [];
        $('[id], [name]').each(function() {
            const el = $(this);
            const data = el.data();
            const kendoData = {};

            for (const key in data) {
                if (key.startsWith('kendo')) {
                    kendoData[key] = data[key];
                }
            }

            if (Object.keys(kendoData).length > 0) {
                widgets.push({
                    id: el.attr('id'),
                    name: el.attr('name'),
                    tagName: this.tagName,
                    kendoWidgets: Object.keys(kendoData)
                });
            }
        });

        console.log(LOG_PREFIX, `Found ${widgets.length} elements with Kendo widgets:`);
        console.table(widgets);

        return widgets;
    }

    /**
     * Perform the actual auto-fill
     */
    function performAutoFill(params) {
        console.log(LOG_PREFIX, "═══════════════════════════════════════");
        console.log(LOG_PREFIX, "STARTING AUTO-FILL");
        console.log(LOG_PREFIX, "Parameters received:", params);
        console.log(LOG_PREFIX, "═══════════════════════════════════════");

        // Debug: List all Kendo widgets on the page
        debugListKendoWidgets();

        let successCount = 0;
        const results = [];

        // Fill Broker ID
        console.log(LOG_PREFIX, "\n--- Attempting to fill Broker ID ---");
        if (params.brokerId) {
            const success = fillKendoComboBox('#Broker', params.brokerId, false);
            results.push({ field: 'Broker ID', selector: '#Broker', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Broker ID not provided, skipping");
            results.push({ field: 'Broker ID', selector: '#Broker', success: false, reason: 'No value provided' });
        }

        // Fill Insurer Name (use the hidden input #Insurer, which will auto-fill visible input)
        console.log(LOG_PREFIX, "\n--- Attempting to fill Insurer Name ---");
        if (params.insurerName) {
            const success = fillKendoComboBox('#Insurer', params.insurerName, true);
            results.push({ field: 'Insurer Name', selector: '#Insurer', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Insurer Name not provided, skipping");
            results.push({ field: 'Insurer Name', selector: '#Insurer', success: false, reason: 'No value provided' });
        }

        // Fill Date Range
        console.log(LOG_PREFIX, "\n--- Attempting to fill Date From ---");
        if (params.dateFrom) {
            const success = fillKendoDatePicker('#SLASubmissionDateFrom', params.dateFrom);
            results.push({ field: 'Date From', selector: '#SLASubmissionDateFrom', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Date From not provided, skipping");
            results.push({ field: 'Date From', selector: '#SLASubmissionDateFrom', success: false, reason: 'No value provided' });
        }

        console.log(LOG_PREFIX, "\n--- Attempting to fill Date To ---");
        if (params.dateTo) {
            const success = fillKendoDatePicker('#SLASubmissionDateTo', params.dateTo);
            results.push({ field: 'Date To', selector: '#SLASubmissionDateTo', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Date To not provided, skipping");
            results.push({ field: 'Date To', selector: '#SLASubmissionDateTo', success: false, reason: 'No value provided' });
        }

        // Fill Transaction Type (for transaction search only)
        console.log(LOG_PREFIX, "\n--- Attempting to fill Transaction Type ---");
        if (params.transactionType) {
            const success = fillKendoComboBox('#TransactionTypeId', params.transactionType, false);
            results.push({ field: 'Transaction Type', selector: '#TransactionTypeId', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Transaction Type not provided, skipping");
            results.push({ field: 'Transaction Type', selector: '#TransactionTypeId', success: false, reason: 'No value provided' });
        }

        // Fill Transaction Status (for transaction search only)
        console.log(LOG_PREFIX, "\n--- Attempting to fill Transaction Status ---");
        if (params.transactionStatus) {
            const success = fillKendoComboBox('#TransactionStatus', params.transactionStatus, false);
            results.push({ field: 'Transaction Status', selector: '#TransactionStatus', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Transaction Status not provided, skipping");
            results.push({ field: 'Transaction Status', selector: '#TransactionStatus', success: false, reason: 'No value provided' });
        }

        console.log(LOG_PREFIX, "\n═══════════════════════════════════════");
        console.log(LOG_PREFIX, "AUTO-FILL COMPLETE");
        console.log(LOG_PREFIX, `Success: ${successCount} / ${results.length} fields`);
        console.log(LOG_PREFIX, "Results:", results);
        console.log(LOG_PREFIX, "═══════════════════════════════════════\n");

        // Show success notification
        showSuccessNotification(successCount);

        // Clear pending search (check both keys)
        ext.storage.local.remove(['pendingPolicySearch', 'pendingTransactionSearch']);
    }

    /**
     * Show success notification after auto-fill
     */
    function showSuccessNotification(count) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10002;
            background: #5cb85c;
            color: white;
            border-radius: 8px;
            padding: 15px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            max-width: 350px;
        `;
        notification.innerHTML = `<div style="font-weight: bold;">✓ Auto-filled ${count} field${count !== 1 ? 's' : ''}!</div><div style="margin-top: 4px; font-size: 12px; opacity: 0.9;">You can now click Search to find similar policies</div>`;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    // Initialize when Kendo is ready
    console.log(LOG_PREFIX, "Starting waitForKendo...");
    waitForKendo(() => {
        console.log(LOG_PREFIX, "jQuery and Kendo are available, checking for pending search");

        // Wait a bit more for form to be fully initialized
        setTimeout(() => {
            console.log(LOG_PREFIX, "Calling autoFillSearchForm after 1 second delay");
            autoFillSearchForm();
        }, 1000);
    });

})();
