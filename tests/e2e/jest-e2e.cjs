module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../..',
  testRegex: 'tests/e2e/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
};
