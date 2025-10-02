/*************************************************************************************************
 *  config-loader-simple.js - Simplified configuration loader using JSON
 *************************************************************************************************/
(function() {
    "use strict";

    const ConfigLoader = {
        /**
         * Load and validate the configuration file
         * @returns {Promise<Object>} Configuration object or error object
         */
        load: async function() {
            try {
                const ext = (typeof browser !== 'undefined') ? browser : chrome;
                const configUrl = ext.runtime.getURL('checklist-config.json');

                const response = await fetch(configUrl);
                if (!response.ok) {
                    return {
                        error: {
                            type: 'LOAD_ERROR',
                            message: `Failed to load configuration: ${response.statusText}`
                        }
                    };
                }

                const config = await response.json();

                // Basic validation
                if (!config.checklist || !Array.isArray(config.checklist)) {
                    return {
                        error: {
                            type: 'VALIDATION_ERROR',
                            message: 'Invalid configuration: missing checklist array'
                        }
                    };
                }

                return {
                    metadata: config.metadata || {},
                    policyNumber: config.policy_number || { selector: '#PolicyNumber' },
                    checklist: config.checklist,
                    raw: config
                };
            } catch (error) {
                return {
                    error: {
                        type: 'UNEXPECTED_ERROR',
                        message: error.message
                    }
                };
            }
        },

        showErrorNotification: function(errorObject) {
            const message = errorObject.error ? errorObject.error.message : 'Unknown error';
            console.error('[ProcessingChecklist Config Error]', message);
        }
    };

    window.ConfigLoader = ConfigLoader;
})();
