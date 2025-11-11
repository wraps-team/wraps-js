# Contributing to Wraps JS

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 8+

### Installation

```bash
# Install pnpm globally
npm install -g pnpm
# OR use corepack (recommended)
corepack enable

# Clone the repository
git clone https://github.com/wraps-team/wraps-js.git
cd wraps-js

# Install dependencies for all packages
pnpm install
```

## Building

### Build all packages

```bash
pnpm build
```

### Build a specific package

```bash
cd packages/email
pnpm build          # Production build (CJS + ESM)
pnpm dev            # Watch mode - auto-rebuild on changes
```

### Clean build artifacts

```bash
cd packages/email
pnpm clean
```

### Build output

After building, you'll find:
- `dist/index.js` - CommonJS build
- `dist/index.mjs` - ESM build
- `dist/index.d.ts` - TypeScript declarations
- `dist/*.map` - Source maps

## Development Workflow

### Type checking

```bash
# Check all packages
pnpm typecheck

# Check specific package
cd packages/email
pnpm typecheck
```

### Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for fast linting and formatting.

```bash
# Check for issues (from root)
pnpm lint

# Fix issues automatically
pnpm lint:fix

# Format all files
pnpm format

# From a specific package
cd packages/email
pnpm lint
pnpm lint:fix
pnpm format
```

### Testing

```bash
# Run tests for all packages
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests for specific package
cd packages/email
pnpm test

# Watch mode
pnpm test:watch
```

## Package Structure

Each package should follow this structure:

```
packages/<package-name>/
├── src/           # TypeScript source files
├── dist/          # Compiled output (gitignored)
├── examples/      # Usage examples
├── package.json
├── tsconfig.json
├── README.md
└── .eslintrc.js
```

## Publishing

### Prerequisites

1. You need to be added as a maintainer to the @wraps npm organization
2. Set up your npm authentication token in GitHub secrets as `NPM_TOKEN`

### Release Process

1. **Update version in package.json**
   ```bash
   cd packages/email
   npm version patch|minor|major
   ```

2. **Commit and push changes**
   ```bash
   git add .
   git commit -m "chore: bump @wraps/email to vX.X.X"
   git push
   ```

3. **Create a GitHub release**
   - Go to https://github.com/wraps-team/wraps-js/releases/new
   - Create a new tag (e.g., `email-v0.1.0`)
   - Title: `@wraps-js/email v0.1.0`
   - Description: Describe the changes
   - Publish release

4. **GitHub Actions will automatically publish to npm**
   - The `publish.yml` workflow will run
   - Package will be published to npm as `@wraps-js/email`

### Manual Publishing (if needed)

```bash
cd packages/email

# Clean and build
npm run clean
npm run build

# Publish to npm
npm publish --access public
```

## Adding a New Package

1. Create directory structure:
   ```bash
   mkdir -p packages/<new-package>/src
   ```

2. Copy template files from an existing package:
   - package.json
   - tsconfig.json
   - .eslintrc.js
   - README.md

3. Update package.json with correct name and details

4. Implement your package in `src/`

5. Add to root README.md

## Code Style

This project uses **Biome** for consistent code style and linting.

Configuration is in `biome.json` at the root level.

### Rules:
- Use TypeScript for all source code
- Single quotes for strings
- Semicolons required
- 2 space indentation
- 100 character line width
- Use `const` over `let` when possible
- No `var` declarations
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Export types alongside implementation

Run `npm run format` before committing to ensure consistent formatting.

## Testing Guidelines

- Write tests for all public APIs
- Use descriptive test names
- Mock AWS SDK calls
- Test error cases
- Aim for >80% coverage

## Documentation

- Update README.md with new features
- Add examples for new functionality
- Document breaking changes clearly
- Keep examples directory up to date

## Commit Message Format

Follow conventional commits:

```
type(scope): subject

body

footer
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `chore`: Maintenance tasks
- `refactor`: Code refactoring
- `test`: Adding tests
- `ci`: CI/CD changes

Examples:
- `feat(email): add template preview support`
- `fix(email): handle empty email addresses`
- `docs(email): update React.email examples`

## Questions?

Open an issue or reach out to the maintainers!
