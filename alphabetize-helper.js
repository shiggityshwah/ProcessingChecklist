/*************************************************************************************************
 *  alphabetize-helper.js - Validation and correction for Policy Number and Named Insured fields
 *  Based on alphabetizing rules from alphabetizing rules.txt
 *************************************************************************************************/
(function() {
    "use strict";

    const AlphabetizeHelper = {
        /**
         * Validate and correct a policy number according to the declaration page format
         * @param {string} value - The policy number to validate
         * @returns {{isValid: boolean, fixedValue: string, message: string}} Validation result
         */
        validatePolicyNumber(value) {
            if (!value || value.trim() === '') {
                return { isValid: true, fixedValue: value, message: '' };
            }

            // Rule: Strip spaces but preserve punctuation
            let fixedValue = value.replace(/\s+/g, '');

            const isValid = value === fixedValue;
            const message = isValid ? '' : 'Policy numbers should not contain spaces';

            console.log('[AlphabetizeHelper] Policy Number validation:', { value, fixedValue, isValid, message });

            return { isValid, fixedValue, message };
        },

        /**
         * Validate and correct a Named Insured field according to alphabetizing rules
         * @param {string} value - The named insured value to validate
         * @returns {{isValid: boolean, fixedValue: string, message: string}} Validation result
         */
        validateNamedInsured(value) {
            if (!value || value.trim() === '') {
                return { isValid: true, fixedValue: value, message: '' };
            }

            let fixedValue = value;

            // First: Remove leading/trailing commas, semicolons, and periods
            fixedValue = this._removeLeadingTrailingPunctuation(fixedValue);

            // Section 1: Punctuation Rules
            // Rule: Remove periods except in website domains
            fixedValue = this._removePeriods(fixedValue);

            // Rule: Replace "and", semicolons, and commas with ampersands (except comma before entity type)
            fixedValue = this._replaceWithAmpersands(fixedValue);

            // Rule: Remove "or" replacement with ampersand (keep "or")
            fixedValue = this._handleOrKeyword(fixedValue);

            // Rule: Handle initials - remove periods and maintain spacing
            fixedValue = this._handleInitials(fixedValue);

            // Section 2: Format Rules
            // Rule: Remove unnecessary articles (The, A, An) at the beginning
            fixedValue = this._removeLeadingArticles(fixedValue);

            // Rule: Remove descriptions following names
            fixedValue = this._removeDescriptions(fixedValue);

            // Rule: Handle shared surnames (e.g., "John Doe and Jane Doe" → "John & Jane Doe")
            fixedValue = this._handleSharedSurnames(fixedValue);

            // Clean up extra spaces
            fixedValue = fixedValue.replace(/\s+/g, ' ').trim();

            // Final cleanup: Remove any remaining leading/trailing punctuation
            fixedValue = this._removeLeadingTrailingPunctuation(fixedValue);

            const isValid = value === fixedValue;
            const message = isValid ? '' : 'Named Insured formatting can be improved';

            console.log('[AlphabetizeHelper] Named Insured validation:', { value, fixedValue, isValid, message });

            return { isValid, fixedValue, message };
        },

        /**
         * Remove leading and trailing punctuation (commas, semicolons, periods)
         * @private
         */
        _removeLeadingTrailingPunctuation(text) {
            // Remove leading punctuation (,;.)
            let result = text.replace(/^[,;.\s]+/, '');
            // Remove trailing punctuation (,;.)
            result = result.replace(/[,;.\s]+$/, '');
            return result;
        },

        /**
         * Remove periods except in website domains (.com, .edu, .org, .io, etc.)
         * @private
         */
        _removePeriods(text) {
            // Match website domains (word + dot + extension)
            const domainRegex = /\b\w+\.(com|edu|org|io|net|gov|mil|info|biz|co|us|uk|ca)\b/gi;
            const domains = [];

            // Extract and preserve domains
            let result = text.replace(domainRegex, (match) => {
                const placeholder = `__DOMAIN${domains.length}__`;
                domains.push(match);
                return placeholder;
            });

            // Remove all periods
            result = result.replace(/\./g, '');

            // Restore domains
            domains.forEach((domain, index) => {
                result = result.replace(`__DOMAIN${index}__`, domain);
            });

            return result;
        },

        /**
         * Replace "and", semicolons, and commas with ampersands
         * Exception: Commas between company name and entity type (e.g., "ABC, LLC")
         * @private
         */
        _replaceWithAmpersands(text) {
            let result = text;

            // Replace semicolons with ampersands
            result = result.replace(/\s*;\s*/g, ' & ');

            // Replace " and " with " & "
            result = result.replace(/\s+and\s+/gi, ' & ');

            // Replace commas with ampersands EXCEPT before entity types
            const entityTypes = ['LLC', 'Inc', 'LP', 'LLP', 'Corp', 'Corporation', 'Ltd', 'Limited', 'PC', 'PA'];
            const entityPattern = new RegExp(`\\s*,\\s+(${entityTypes.join('|')})\\b`, 'gi');

            // First preserve entity commas
            const preservedEntities = [];
            result = result.replace(entityPattern, (match, entityType) => {
                const placeholder = `__ENTITY${preservedEntities.length}__`;
                preservedEntities.push(` ${entityType}`);
                return placeholder;
            });

            // Replace remaining commas with ampersands
            result = result.replace(/\s*,\s*/g, ' & ');

            // Restore entity commas
            preservedEntities.forEach((entity, index) => {
                result = result.replace(`__ENTITY${index}__`, entity);
            });

            return result;
        },

        /**
         * Handle "or" keyword - replace with "or" (keep as is per rules)
         * @private
         */
        _handleOrKeyword(text) {
            // Per the rules: "or" should be replaced with "or" (meaning keep it as is)
            // The rule says "Don't replace the word 'or' with ampersands"
            return text.replace(/\s+or\s+/gi, ' or ');
        },

        /**
         * Handle initials - remove periods and maintain spaces
         * Example: "Dr. F.P. Jones, M.D." → "Dr F P Jones MD"
         * @private
         */
        _handleInitials(text) {
            // Already handled by _removePeriods, just ensure proper spacing
            return text;
        },

        /**
         * Remove leading articles (The, A, An) only when not integral to the name
         * Preserve articles elsewhere in the name
         * @private
         */
        _removeLeadingArticles(text) {
            let result = text.trim();

            // Check for leading articles
            const leadingArticlePattern = /^(The|A|An)\s+/i;
            const match = result.match(leadingArticlePattern);

            if (!match) return result;

            // Remove the leading article
            const withoutArticle = result.replace(leadingArticlePattern, '');

            // Check if it's an integral part by looking for exceptions
            // If the name is very short or looks like "A Plus Preschool", keep the article
            const integralPatterns = [
                /^Plus\s/i,  // "A Plus"
                /^[A-Z]\s/,  // Single letter after article
                /^\d/        // Starts with number
            ];

            for (const pattern of integralPatterns) {
                if (pattern.test(withoutArticle)) {
                    return result; // Keep the article
                }
            }

            // Remove article from each entity separated by &
            result = result.replace(/&\s+(The|A|An)\s+/gi, '& ');

            return withoutArticle;
        },

        /**
         * Remove descriptions following names (e.g., "HWJT", "JT", "et al")
         * @private
         */
        _removeDescriptions(text) {
            // Remove trailing descriptions
            const descriptionPatterns = [
                /\s*,\s*(HWJT|JT|et al|et alia)\s*$/i,
                /\s+(HWJT|JT|et al|et alia)\s*$/i
            ];

            let result = text;
            descriptionPatterns.forEach(pattern => {
                result = result.replace(pattern, '');
            });

            return result;
        },

        /**
         * Handle shared surnames
         * Example: "John Doe and Jane Doe" → "John & Jane Doe"
         * @private
         */
        _handleSharedSurnames(text) {
            // Pattern: FirstName LastName & FirstName LastName (same LastName)
            // This is complex - for now, leave as is since ampersand conversion handles most cases
            // A full implementation would need name parsing

            // Simple pattern: "Name1 Surname & Name2 Surname" → "Name1 & Name2 Surname"
            const sharedSurnamePattern = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+&\s+([A-Z][a-z]+)\s+\2\b/g;
            return text.replace(sharedSurnamePattern, '$1 & $3 $2');
        },

        /**
         * Get field selectors from config for fields that need validation
         * @param {Object} config - The checklist configuration
         * @returns {Array} Array of field info objects with selector and type
         */
        getValidatableFields(config) {
            const fields = [];

            console.log('[AlphabetizeHelper] getValidatableFields - config:', config);

            // Policy Number
            console.log('[AlphabetizeHelper] Checking policy_number:', config.policy_number);
            if (config.policy_number && config.policy_number.selector) {
                console.log('[AlphabetizeHelper] Adding policy number field:', config.policy_number.selector);
                fields.push({
                    selector: config.policy_number.selector,
                    type: 'policyNumber',
                    label: config.policy_number.label || 'Policy Number'
                });
            }

            // Primary and Secondary Insured from checklist
            if (config.checklist) {
                config.checklist.forEach(item => {
                    if (item.fields) {
                        item.fields.forEach(field => {
                            if (field.selector === '#PrimaryInsuredName') {
                                console.log('[AlphabetizeHelper] Adding Primary Insured field');
                                fields.push({
                                    selector: field.selector,
                                    type: 'namedInsured',
                                    label: 'Primary Insured'
                                });
                            } else if (field.selector === '#SecondaryInsuredName') {
                                console.log('[AlphabetizeHelper] Adding Secondary Insured field');
                                fields.push({
                                    selector: field.selector,
                                    type: 'namedInsured',
                                    label: 'Secondary Insured'
                                });
                            } else if (field.selector === '#PolicyNumber') {
                                console.log('[AlphabetizeHelper] Adding Policy Number from checklist fields');
                                // Check if we already added this from policy_number config
                                const exists = fields.some(f => f.selector === field.selector);
                                if (!exists) {
                                    fields.push({
                                        selector: field.selector,
                                        type: 'policyNumber',
                                        label: 'Policy Number'
                                    });
                                }
                            }
                        });
                    }
                });
            }

            // Also check primary_insured config
            if (config.primary_insured && config.primary_insured.selector) {
                const exists = fields.some(f => f.selector === config.primary_insured.selector);
                if (!exists) {
                    console.log('[AlphabetizeHelper] Adding field from primary_insured config');
                    fields.push({
                        selector: config.primary_insured.selector,
                        type: 'namedInsured',
                        label: config.primary_insured.label || 'Primary Insured'
                    });
                }
            }

            console.log('[AlphabetizeHelper] Final validatable fields:', fields);
            return fields;
        }
    };

    // Expose the helper globally
    window.AlphabetizeHelper = AlphabetizeHelper;
})();
