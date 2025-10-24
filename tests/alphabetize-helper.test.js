/*************************************************************************************************
 *  alphabetize-helper.test.js - Unit tests for alphabetize-helper.js
 *  Run with: Open tests/test-runner-alphabetize.html in Firefox
 *************************************************************************************************/

// Simple test framework
const TestRunner = {
    tests: [],
    passed: 0,
    failed: 0,

    test(name, fn) {
        this.tests.push({ name, fn });
    },

    async run() {
        console.log('=== Running AlphabetizeHelper Tests ===\n');
        this.passed = 0;
        this.failed = 0;

        for (const test of this.tests) {
            try {
                await test.fn();
                this.passed++;
                console.log(`✓ ${test.name}`);
            } catch (e) {
                this.failed++;
                console.error(`✗ ${test.name}`);
                console.error(`  ${e.message}`);
            }
        }

        console.log(`\n=== Test Results ===`);
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Total: ${this.tests.length}`);

        return this.failed === 0;
    },

    assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    },

    assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected "${expected}", got "${actual}"`);
        }
    }
};

// Wait for alphabetize-helper.js to load
window.addEventListener('DOMContentLoaded', () => {
    const Helper = window.AlphabetizeHelper;

    // ===== Policy Number Tests =====
    TestRunner.test('validatePolicyNumber - should accept valid policy numbers', () => {
        const result = Helper.validatePolicyNumber('ABC-123-456');
        TestRunner.assert(result.isValid, 'Should be valid');
        TestRunner.assertEqual(result.fixedValue, 'ABC-123-456');
        TestRunner.assertEqual(result.message, '');
    });

    TestRunner.test('validatePolicyNumber - should remove spaces', () => {
        const result = Helper.validatePolicyNumber('ABC 123 456');
        TestRunner.assert(!result.isValid, 'Should be invalid due to spaces');
        TestRunner.assertEqual(result.fixedValue, 'ABC123456');
        TestRunner.assertEqual(result.message, 'Policy numbers should not contain spaces');
    });

    TestRunner.test('validatePolicyNumber - should handle empty input', () => {
        const result = Helper.validatePolicyNumber('');
        TestRunner.assert(result.isValid, 'Empty should be valid');
        TestRunner.assertEqual(result.fixedValue, '');
    });

    // ===== Named Insured Tests =====
    TestRunner.test('validateNamedInsured - should remove leading "The"', () => {
        const result = Helper.validateNamedInsured('The Smith Company');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'Smith Company');
    });

    TestRunner.test('validateNamedInsured - should keep integral "The"', () => {
        const result = Helper.validateNamedInsured('The Who');
        TestRunner.assert(result.isValid, 'Short names should keep "The"');
        TestRunner.assertEqual(result.fixedValue, 'The Who');
    });

    TestRunner.test('validateNamedInsured - should replace "and" with ampersand', () => {
        const result = Helper.validateNamedInsured('John Smith and Jane Doe');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith & Jane Doe');
    });

    TestRunner.test('validateNamedInsured - should replace semicolons with ampersands', () => {
        const result = Helper.validateNamedInsured('ABC Company; XYZ Corp');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'ABC Company & XYZ Corp');
    });

    TestRunner.test('validateNamedInsured - should keep "or"', () => {
        const result = Helper.validateNamedInsured('John or Jane');
        TestRunner.assert(result.isValid, 'Should keep "or"');
        TestRunner.assertEqual(result.fixedValue, 'John or Jane');
    });

    TestRunner.test('validateNamedInsured - should remove periods except in domains', () => {
        const result = Helper.validateNamedInsured('Dr. Smith Inc.');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'Dr Smith Inc');
    });

    TestRunner.test('validateNamedInsured - should preserve domain periods', () => {
        const result = Helper.validateNamedInsured('example.com LLC');
        TestRunner.assert(result.isValid, 'Should preserve .com');
        TestRunner.assertEqual(result.fixedValue, 'example.com LLC');
    });

    TestRunner.test('validateNamedInsured - should handle commas before entity types', () => {
        const result = Helper.validateNamedInsured('ABC Company, LLC');
        TestRunner.assert(result.isValid, 'Comma before LLC should be preserved');
        TestRunner.assertEqual(result.fixedValue, 'ABC Company LLC');
    });

    TestRunner.test('validateNamedInsured - should replace other commas with ampersands', () => {
        const result = Helper.validateNamedInsured('Smith, Jones, Brown');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'Smith & Jones & Brown');
    });

    TestRunner.test('validateNamedInsured - should remove trailing descriptions', () => {
        const result = Helper.validateNamedInsured('John Smith, HWJT');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith');
    });

    TestRunner.test('validateNamedInsured - should remove "et al"', () => {
        const result = Helper.validateNamedInsured('John Smith et al');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith');
    });

    TestRunner.test('validateNamedInsured - should handle complex case', () => {
        const result = Helper.validateNamedInsured('The ABC Company, Inc. and XYZ Corp.; DEF, LLC');
        TestRunner.assert(!result.isValid, 'Should need multiple corrections');
        // Expected: Remove "The", replace "and" and ";" with "&", preserve "Inc" and "LLC"
        const expected = 'ABC Company Inc & XYZ Corp & DEF LLC';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('validateNamedInsured - should trim whitespace', () => {
        const result = Helper.validateNamedInsured('  John Smith  ');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith');
    });

    TestRunner.test('validateNamedInsured - should handle empty input', () => {
        const result = Helper.validateNamedInsured('');
        TestRunner.assert(result.isValid, 'Empty should be valid');
        TestRunner.assertEqual(result.fixedValue, '');
    });

    TestRunner.test('validateNamedInsured - should remove leading/trailing punctuation', () => {
        const result = Helper.validateNamedInsured(',John Smith,');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith');
    });

    TestRunner.test('validateNamedInsured - should handle multiple spaces', () => {
        const result = Helper.validateNamedInsured('John    Smith');
        TestRunner.assert(!result.isValid, 'Should need correction');
        TestRunner.assertEqual(result.fixedValue, 'John Smith');
    });

    // ===== Integration Tests =====
    TestRunner.test('Integration - real world example 1', () => {
        const input = 'The Johnson & Johnson, Inc. and Smith Bros., LLC';
        const result = Helper.validateNamedInsured(input);
        // Expected: Remove "The", preserve "&", keep "Inc" and "LLC"
        const expected = 'Johnson & Johnson Inc & Smith Bros LLC';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Integration - real world example 2', () => {
        const input = 'Dr. F.P. Jones, M.D., HWJT';
        const result = Helper.validateNamedInsured(input);
        // Expected: Remove periods, remove HWJT, remove trailing MD
        const expected = 'Dr F P Jones MD';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Integration - real world example 3', () => {
        const input = 'ABC Corp.; XYZ Company, LLC; John Doe';
        const result = Helper.validateNamedInsured(input);
        // Expected: Replace semicolons with &, preserve LLC
        const expected = 'ABC Corp & XYZ Company LLC & John Doe';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    // ===== Shared Surname Tests =====
    TestRunner.test('Shared surname - should combine with shared surname', () => {
        const input = 'John Smith and Jane Smith';
        const result = Helper.validateNamedInsured(input);
        // Expected: Combine first names with shared surname
        const expected = 'John & Jane Smith';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Shared surname - should handle trustee suffix on individual', () => {
        const input = 'Bob Smith Trustee';
        const result = Helper.validateNamedInsured(input);
        // Expected: Trustee should be treated as suffix
        const expected = 'Bob Smith Trustee';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Shared surname - should handle trustees suffix on group', () => {
        const input = 'Bob Smith and Maggie Ann Smith Trustees';
        const result = Helper.validateNamedInsured(input);
        // Expected: Combine first names, shared surname, then trustees suffix
        const expected = 'Bob & Maggie Ann Smith Trustees';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Shared surname - should handle trustees with middle names', () => {
        const input = 'John William Smith and Mary Elizabeth Smith Trustees';
        const result = Helper.validateNamedInsured(input);
        // Expected: Combine with middle names preserved
        const expected = 'John William & Mary Elizabeth Smith Trustees';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    TestRunner.test('Shared surname - should handle three people with trustees', () => {
        const input = 'Bob Smith and Maggie Ann Smith and Charlie Smith Trustees';
        const result = Helper.validateNamedInsured(input);
        // Expected: Combine all three with shared surname and trustees suffix
        const expected = 'Bob & Maggie Ann & Charlie Smith Trustees';
        TestRunner.assertEqual(result.fixedValue, expected);
    });

    // Run all tests
    TestRunner.run().then(success => {
        if (success) {
            document.body.style.backgroundColor = '#d4edda';
            document.body.innerHTML = '<h1 style="color: #155724; text-align: center; padding: 50px;">All AlphabetizeHelper Tests Passed! ✓</h1>';
        } else {
            document.body.style.backgroundColor = '#f8d7da';
            document.body.innerHTML = '<h1 style="color: #721c24; text-align: center; padding: 50px;">Some Tests Failed! ✗</h1><p style="text-align: center;">Check console for details.</p>';
        }
    });
});
