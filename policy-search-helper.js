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
    const MAX_WAIT_ATTEMPTS = 100; // 10 seconds max

    function waitForKendo(callback) {
        waitAttempts++;

        // Check multiple jQuery locations
        const $ = window.jQuery || window.$ || (window.frames && window.frames.jQuery);
        const kendo = window.kendo;

        if ($ && kendo) {
            console.log(LOG_PREFIX, "jQuery and Kendo are now available, proceeding with callback");
            window.jQuery = $; // Ensure it's accessible
            callback();
        } else if (waitAttempts >= MAX_WAIT_ATTEMPTS) {
            console.error(LOG_PREFIX, "Timeout waiting for jQuery/Kendo after 10 seconds");
            console.log(LOG_PREFIX, "Attempting to proceed without Kendo widgets...");
            // Still try to check storage and show notification
            autoFillSearchForm();
        } else {
            if (waitAttempts % 10 === 0) {
                console.log(LOG_PREFIX, `Still waiting for jQuery/Kendo... Attempt ${waitAttempts}/${MAX_WAIT_ATTEMPTS}. jQuery:`, typeof $, "Kendo:", typeof kendo);
            }
            setTimeout(() => waitForKendo(callback), 100);
        }
    }

    /**
     * Fill Kendo ComboBox with value
     */
    function fillKendoComboBox(selector, value, isText = false) {
        console.log(LOG_PREFIX, `fillKendoComboBox called with selector: ${selector}, value:`, value, `isText: ${isText}`);

        const element = window.jQuery(selector);
        console.log(LOG_PREFIX, `jQuery element found:`, element.length > 0, `Element:`, element);

        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return false;
        }

        const widget = element.data('kendoComboBox');
        console.log(LOG_PREFIX, `Kendo ComboBox widget:`, widget);

        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo ComboBox widget not found for: ${selector}`);
            // List all available data attributes to help debug
            const allData = element.data();
            console.log(LOG_PREFIX, `Available data attributes on element:`, allData);
            return false;
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
            return false;
        }
    }

    /**
     * Fill Kendo DatePicker with date
     */
    function fillKendoDatePicker(selector, dateString) {
        console.log(LOG_PREFIX, `fillKendoDatePicker called with selector: ${selector}, dateString:`, dateString);

        const element = window.jQuery(selector);
        console.log(LOG_PREFIX, `jQuery element found:`, element.length > 0, `Element:`, element);

        if (element.length === 0) {
            console.warn(LOG_PREFIX, `Element not found: ${selector}`);
            return false;
        }

        const widget = element.data('kendoDatePicker');
        console.log(LOG_PREFIX, `Kendo DatePicker widget:`, widget);

        if (!widget) {
            console.warn(LOG_PREFIX, `Kendo DatePicker widget not found for: ${selector}`);
            // List all available data attributes to help debug
            const allData = element.data();
            console.log(LOG_PREFIX, `Available data attributes on element:`, allData);
            return false;
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
            return false;
        }
    }

    /**
     * Auto-fill search form with pending parameters
     */
    function autoFillSearchForm() {
        console.log(LOG_PREFIX, "autoFillSearchForm called, checking storage...");
        ext.storage.local.get('pendingPolicySearch', (result) => {
            console.log(LOG_PREFIX, "Storage result:", result);

            if (!result.pendingPolicySearch) {
                console.log(LOG_PREFIX, "No pending search parameters found in storage");
                return;
            }

            const params = result.pendingPolicySearch;
            console.log(LOG_PREFIX, "Found params:", params);

            // Check if parameters are recent (within last 5 minutes)
            const age = Date.now() - params.timestamp;
            console.log(LOG_PREFIX, "Parameter age (ms):", age, "Max allowed:", 5 * 60 * 1000);

            if (age > 5 * 60 * 1000) {
                console.log(LOG_PREFIX, "Pending search parameters are too old, ignoring");
                ext.storage.local.remove('pendingPolicySearch');
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

        // Check if we have jQuery/Kendo for auto-fill
        const hasKendo = typeof window.jQuery !== 'undefined' && typeof window.kendo !== 'undefined';
        console.log(LOG_PREFIX, "hasKendo:", hasKendo);

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

        if (hasKendo) {
            // Show auto-fill option
            html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; gap: 8px;">';
            html += '<button id="autoFillYesBtn" style="flex: 1; background: white; color: #5cb85c; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Fill Form</button>';
            html += '<button id="autoFillNoBtn" style="flex: 1; background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Dismiss</button>';
            html += '</div>';
        } else {
            // Show manual instructions
            html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 13px;">';
            html += '📋 <strong>Manual Fill Instructions:</strong><br>';
            html += 'Enter the values above into the search form fields.';
            html += '</div>';
            html += '<button id="dismissBtn" style="margin-top: 10px; width: 100%; background: white; color: #5cb85c; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Got It</button>';
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

        if (hasKendo) {
            // Yes button - perform auto-fill
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
        } else {
            // Dismiss button
            const dismissBtn = document.getElementById('dismissBtn');
            if (dismissBtn) {
                dismissBtn.addEventListener('click', () => {
                    notification.remove();
                    ext.storage.local.remove('pendingPolicySearch');
                });
            }
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

        // Fill Insurer Name (use text mode)
        console.log(LOG_PREFIX, "\n--- Attempting to fill Insurer Name ---");
        if (params.insurerName) {
            const success = fillKendoComboBox('#Insurer_input', params.insurerName, true);
            results.push({ field: 'Insurer Name', selector: '#Insurer_input', success });
            if (success) successCount++;
        } else {
            console.log(LOG_PREFIX, "Insurer Name not provided, skipping");
            results.push({ field: 'Insurer Name', selector: '#Insurer_input', success: false, reason: 'No value provided' });
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

        console.log(LOG_PREFIX, "\n═══════════════════════════════════════");
        console.log(LOG_PREFIX, "AUTO-FILL COMPLETE");
        console.log(LOG_PREFIX, `Success: ${successCount} / ${results.length} fields`);
        console.log(LOG_PREFIX, "Results:", results);
        console.log(LOG_PREFIX, "═══════════════════════════════════════\n");

        // Show success notification
        showSuccessNotification(successCount);

        // Clear pending search
        ext.storage.local.remove('pendingPolicySearch');
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
