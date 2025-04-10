//jest testing config
module.exports = {
    testEnvironment: 'node',
    coveragePathIgnorePatterns: ['/node_modules/'],
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    collectCoverage: true,
    collectCoverageFrom: ['**/*.js', '!**/node_modules/**', '!**/coverage/**', '!**/tests/**'],
    coverageReporters: ['text', 'lcov'],
    testTimeout: 10000
};