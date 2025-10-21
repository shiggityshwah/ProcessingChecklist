/*************************************************************************************************
 *  utils.test.js - Unit tests for utils.js
 *  Run with: Open tests/test-runner.html in Firefox
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
        console.log('=== Running Utils Tests ===\n');
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
            throw new Error(message || `Expected ${expected}, got ${actual}`);
        }
    },

    assertDeepEqual(actual, expected, message) {
        const actualStr = JSON.stringify(actual);
        const expectedStr = JSON.stringify(expected);
        if (actualStr !== expectedStr) {
            throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
        }
    }
};

// Wait for utils.js to load
window.addEventListener('DOMContentLoaded', () => {
    const Utils = window.ProcessingChecklistUtils;

    // Test: escapeHtml
    TestRunner.test('escapeHtml - should escape HTML special characters', () => {
        const input = '<script>alert("XSS")</script>';
        const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
        const actual = Utils.escapeHtml(input);
        TestRunner.assertEqual(actual, expected);
    });

    TestRunner.test('escapeHtml - should handle ampersands', () => {
        const input = 'Tom & Jerry';
        const expected = 'Tom &amp; Jerry';
        const actual = Utils.escapeHtml(input);
        TestRunner.assertEqual(actual, expected);
    });

    TestRunner.test('escapeHtml - should handle single quotes', () => {
        const input = "It's a test";
        const expected = "It&#039;s a test";
        const actual = Utils.escapeHtml(input);
        TestRunner.assertEqual(actual, expected);
    });

    TestRunner.test('escapeHtml - should handle non-string input', () => {
        const actual = Utils.escapeHtml(null);
        TestRunner.assertEqual(actual, null);
    });

    // Test: generateUniqueId
    TestRunner.test('generateUniqueId - should generate unique IDs', () => {
        const id1 = Utils.generateUniqueId();
        const id2 = Utils.generateUniqueId();
        TestRunner.assert(id1 !== id2, 'IDs should be unique');
        TestRunner.assert(typeof id1 === 'string', 'ID should be a string');
        TestRunner.assert(id1.length > 10, 'ID should be reasonably long');
    });

    // Test: formatCurrency
    TestRunner.test('formatCurrency - should format numbers correctly', () => {
        const actual = Utils.formatCurrency(1234.56);
        TestRunner.assertEqual(actual, '$1,234.56');
    });

    TestRunner.test('formatCurrency - should handle large numbers', () => {
        const actual = Utils.formatCurrency(1234567.89);
        TestRunner.assertEqual(actual, '$1,234,567.89');
    });

    TestRunner.test('formatCurrency - should handle string input', () => {
        const actual = Utils.formatCurrency('500.25');
        TestRunner.assertEqual(actual, '$500.25');
    });

    TestRunner.test('formatCurrency - should handle invalid input', () => {
        const actual = Utils.formatCurrency('invalid');
        TestRunner.assertEqual(actual, '$0.00');
    });

    // Test: deepClone
    TestRunner.test('deepClone - should clone simple objects', () => {
        const obj = { a: 1, b: 2 };
        const clone = Utils.deepClone(obj);
        TestRunner.assertDeepEqual(clone, obj);
        TestRunner.assert(clone !== obj, 'Clone should be a different object');
    });

    TestRunner.test('deepClone - should clone nested objects', () => {
        const obj = { a: { b: { c: 3 } } };
        const clone = Utils.deepClone(obj);
        TestRunner.assertDeepEqual(clone, obj);
        clone.a.b.c = 99;
        TestRunner.assertEqual(obj.a.b.c, 3, 'Original should not be modified');
    });

    TestRunner.test('deepClone - should clone arrays', () => {
        const arr = [1, 2, [3, 4]];
        const clone = Utils.deepClone(arr);
        TestRunner.assertDeepEqual(clone, arr);
        clone[2][0] = 99;
        TestRunner.assertEqual(arr[2][0], 3, 'Original should not be modified');
    });

    TestRunner.test('deepClone - should handle null', () => {
        const clone = Utils.deepClone(null);
        TestRunner.assertEqual(clone, null);
    });

    TestRunner.test('deepClone - should handle Date objects', () => {
        const date = new Date('2024-01-01');
        const clone = Utils.deepClone(date);
        TestRunner.assertEqual(clone.getTime(), date.getTime());
        TestRunner.assert(clone !== date, 'Clone should be a different Date object');
    });

    // Test: debounce
    TestRunner.test('debounce - should delay function execution', async () => {
        let callCount = 0;
        const fn = () => callCount++;
        const debounced = Utils.debounce(fn, 100);

        debounced();
        debounced();
        debounced();

        TestRunner.assertEqual(callCount, 0, 'Function should not be called immediately');

        await new Promise(resolve => setTimeout(resolve, 150));
        TestRunner.assertEqual(callCount, 1, 'Function should be called once after delay');
    });

    // Test: throttle
    TestRunner.test('throttle - should limit function execution', async () => {
        let callCount = 0;
        const fn = () => callCount++;
        const throttled = Utils.throttle(fn, 100);

        throttled();
        throttled();
        throttled();

        TestRunner.assertEqual(callCount, 1, 'Function should be called immediately once');

        await new Promise(resolve => setTimeout(resolve, 150));
        throttled();
        TestRunner.assertEqual(callCount, 2, 'Function should be callable again after throttle period');
    });

    // Test: validateData
    TestRunner.test('validateData - should validate simple types', () => {
        const schema = { name: 'string', age: 0 };
        const validData = { name: 'John', age: 30 };
        const isValid = Utils.validateData(validData, schema);
        TestRunner.assert(isValid, 'Valid data should pass validation');
    });

    TestRunner.test('validateData - should reject invalid types', () => {
        const schema = { name: 'string', age: 0 };
        const invalidData = { name: 123, age: 30 };
        const isValid = Utils.validateData(invalidData, schema);
        TestRunner.assert(!isValid, 'Invalid data should fail validation');
    });

    TestRunner.test('validateData - should validate arrays', () => {
        const schema = [{ id: 0 }];
        const validData = [{ id: 1 }, { id: 2 }];
        const isValid = Utils.validateData(validData, schema);
        TestRunner.assert(isValid, 'Valid array data should pass validation');
    });

    TestRunner.test('validateData - should handle missing properties', () => {
        const schema = { name: 'string', age: 0 };
        const invalidData = { name: 'John' }; // missing age
        const isValid = Utils.validateData(invalidData, schema);
        TestRunner.assert(!isValid, 'Data with missing properties should fail validation');
    });

    // Test: SelectorCache
    TestRunner.test('SelectorCache - should cache DOM queries', () => {
        // Create a test element
        const testDiv = document.createElement('div');
        testDiv.id = 'test-cache-element';
        document.body.appendChild(testDiv);

        const el1 = Utils.SelectorCache.get('#test-cache-element');
        const el2 = Utils.SelectorCache.get('#test-cache-element');

        TestRunner.assert(el1 === el2, 'Should return same element from cache');
        TestRunner.assertEqual(el1.id, 'test-cache-element');

        // Cleanup
        document.body.removeChild(testDiv);
        Utils.SelectorCache.clear();
    });

    TestRunner.test('SelectorCache - should refresh stale cache', async () => {
        const testDiv = document.createElement('div');
        testDiv.id = 'test-stale-element';
        testDiv.textContent = 'original';
        document.body.appendChild(testDiv);

        // Get with very short TTL
        const el1 = Utils.SelectorCache.get('#test-stale-element', 50);

        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        // Modify element
        testDiv.textContent = 'modified';

        // Get again should re-query
        const el2 = Utils.SelectorCache.get('#test-stale-element', 50);

        TestRunner.assertEqual(el2.textContent, 'modified');

        // Cleanup
        document.body.removeChild(testDiv);
        Utils.SelectorCache.clear();
    });

    TestRunner.test('SelectorCache - should handle removed elements', () => {
        const testDiv = document.createElement('div');
        testDiv.id = 'test-removed-element';
        document.body.appendChild(testDiv);

        const el1 = Utils.SelectorCache.get('#test-removed-element');
        TestRunner.assert(el1 !== null, 'Element should be found');

        // Remove element from DOM
        document.body.removeChild(testDiv);

        // Cache should detect element is no longer in DOM
        const el2 = Utils.SelectorCache.get('#test-removed-element');
        TestRunner.assertEqual(el2, null, 'Should return null for removed element');

        Utils.SelectorCache.clear();
    });

    // Run all tests
    TestRunner.run().then(success => {
        if (success) {
            document.body.style.backgroundColor = '#d4edda';
            document.body.innerHTML = '<h1 style="color: #155724; text-align: center; padding: 50px;">All Tests Passed! ✓</h1>';
        } else {
            document.body.style.backgroundColor = '#f8d7da';
            document.body.innerHTML = '<h1 style="color: #721c24; text-align: center; padding: 50px;">Some Tests Failed! ✗</h1><p style="text-align: center;">Check console for details.</p>';
        }
    });
});
