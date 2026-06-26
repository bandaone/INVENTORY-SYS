# Contributing to Retail OS

Thank you for your interest in contributing to Retail OS! This document provides guidelines and instructions for contributing.

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and provide constructive feedback
- Focus on what is best for the project and community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, discrimination, or trolling
- Publishing others' private information
- Unprofessional or inappropriate conduct
- Spam or promotional content

## Getting Started

### Prerequisites

Before contributing, ensure you have:
- Completed the [Development Setup](docs/development-setup.md)
- Read the [Architecture Guide](docs/architecture.md)
- Familiarized yourself with the codebase

### Finding Issues to Work On

- Check [Issues](https://github.com/your-org/retail-os/issues) tab
- Look for `good-first-issue` or `help-wanted` labels
- Comment on the issue to claim it
- Wait for maintainer approval before starting work

## Development Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub
# Clone your fork
git clone https://github.com/YOUR-USERNAME/retail-os.git
cd retail-os

# Add upstream remote
git remote add upstream https://github.com/your-org/retail-os.git
```

### 2. Create a Branch

```bash
# Update main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-123-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/fixes

### 3. Make Changes

Follow our coding standards (see below) and:
- Write clear, descriptive commit messages
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add mobile money payment timeout handling

- Add 60-second timeout for mobile money webhooks
- Display timeout prompt with retry/cancel options
- Update payment adapter interface
- Add integration tests

Closes #123"
```

Commit message format:
```
<type>: <subject>

<body>

<footer>
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding/updating tests
- `chore` - Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear title describing the change
- Detailed description of what and why
- Link to related issue(s)
- Screenshots/GIFs for UI changes
- Checklist of completed items

## Coding Standards

### TypeScript/JavaScript (Backend, Dashboard)

**Style Guide**: Airbnb style guide with modifications

```typescript
// Use explicit types
function createTransaction(data: TransactionData): Transaction {
  // Implementation
}

// Use async/await over promises
async function fetchData() {
  const data = await api.getData();
  return data;
}

// Use meaningful variable names
const activeGarmentsCount = garments.filter(g => g.status === 'in_stock').length;

// Extract magic numbers to constants
const MAX_RETRY_ATTEMPTS = 3;
const TIMEOUT_MS = 60000;
```

**Formatting**: Prettier with provided config
```bash
npm run format
```

**Linting**: ESLint with TypeScript plugin
```bash
npm run lint
```

### Dart/Flutter (POS Application)

**Style Guide**: Effective Dart

```dart
// Use meaningful class names
class TransactionService {
  // Use final for immutable fields
  final ApiClient _apiClient;
  
  // Document public APIs
  /// Creates a new transaction and syncs to the cloud.
  /// 
  /// Returns the created [Transaction] with receipt number.
  /// Throws [TransactionException] if validation fails.
  Future<Transaction> createTransaction(TransactionData data) async {
    // Implementation
  }
  
  // Use private methods for internal logic
  Future<void> _validateTransaction(TransactionData data) async {
    // Validation logic
  }
}

// Use const constructors where possible
const EdgeInsets.all(16.0)

// Prefer composition over inheritance
class CheckoutScreen extends StatelessWidget {
  final CartService cartService;
  final PaymentService paymentService;
  
  const CheckoutScreen({
    required this.cartService,
    required this.paymentService,
  });
}
```

**Formatting**: dart format
```bash
dart format .
```

**Analysis**: dart analyze
```bash
dart analyze
```

### SQL

```sql
-- Use descriptive names
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Use snake_case for column names
  garment_serial VARCHAR(255) NOT NULL,
  movement_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add comments for complex logic
-- Calculates shrinkage by summing retail prices of missing garments
CREATE VIEW monthly_shrinkage AS
SELECT 
  location_id,
  DATE_TRUNC('month', created_at) as month,
  SUM(retail_price) as shrinkage_value
FROM stock_movements
WHERE movement_type = 'STOCKTAKE_MISSING'
GROUP BY location_id, DATE_TRUNC('month', created_at);
```

## Testing Requirements

### All Changes Must Include Tests

**Backend**:
```typescript
// Unit test example
describe('SyncEngineService', () => {
  it('should detect conflicts correctly', () => {
    // Test implementation
  });
});
```

**Flutter**:
```dart
void main() {
  testWidgets('CartItem displays correctly', (tester) async {
    // Test implementation
  });
}
```

**Dashboard**:
```typescript
describe('DashboardMetrics', () => {
  it('renders metrics', () => {
    // Test implementation
  });
});
```

### Test Coverage

- New code: 80% minimum coverage
- Critical paths: 100% coverage required
- Run coverage locally before submitting PR

```bash
# Backend
cd backend && npm run test:coverage

# POS
cd pos-app && flutter test --coverage

# Dashboard
cd dashboard && npm run test:coverage
```

## Documentation Requirements

### Code Documentation

**TypeScript/JavaScript**: JSDoc comments for public APIs
```typescript
/**
 * Processes a sync batch from a device.
 * 
 * @param tenantId - The tenant ID for isolation
 * @param entries - Array of sync queue entries
 * @returns Result with processed count and conflicts
 * @throws {SyncError} If batch processing fails
 */
async function processSyncBatch(
  tenantId: string,
  entries: SyncQueueEntry[]
): Promise<SyncResult> {
  // Implementation
}
```

**Dart**: Doc comments for public APIs
```dart
/// Authenticates a user with their PIN code.
///
/// Returns a [Staff] object if authentication succeeds.
/// Returns `null` if the PIN is incorrect.
/// Throws [PinLockoutException] if the account is locked.
Future<Staff?> authenticate(String pin) async {
  // Implementation
}
```

### User-Facing Documentation

Update relevant docs for:
- New features → User guides + API reference
- Bug fixes → Add note to CHANGELOG.md
- Breaking changes → Migration guide

## Pull Request Process

### PR Checklist

Before submitting, ensure:

- [ ] Code follows style guidelines
- [ ] All tests pass locally
- [ ] New tests added for new functionality
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] No merge conflicts with main
- [ ] Screenshots/GIFs included for UI changes
- [ ] Breaking changes documented

### Review Process

1. **Automated Checks**: CI/CD runs tests and linting
2. **Code Review**: Maintainer reviews code
3. **Changes Requested**: Address feedback and push updates
4. **Approval**: Maintainer approves PR
5. **Merge**: Maintainer merges to main

### After Merge

- Delete your feature branch
- Update your fork's main branch
- Close related issues

```bash
git checkout main
git pull upstream main
git push origin main
git branch -d feature/your-feature-name
```

## Release Process

### Versioning

We use [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Changelog

All notable changes documented in `CHANGELOG.md`:

```markdown
## [1.2.0] - 2026-06-17

### Added
- Mobile money timeout handling (#123)
- RFID scanner support for stocktake (#145)

### Fixed
- Serial lookup performance issue (#156)
- Sync conflict resolution bug (#167)

### Changed
- Improved dashboard loading time (#178)
```

## Communication

### Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: General questions, ideas
- **Slack**: Real-time chat (invite required)
- **Email**: security@retailos.com (security issues only)

### Reporting Bugs

Use the bug report template:

```markdown
**Describe the bug**
Clear description of the issue

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What should happen

**Screenshots**
If applicable

**Environment**
- OS: [e.g., Windows 11]
- Version: [e.g., 1.0.0]
- Device: [e.g., Desktop, Android phone]

**Additional context**
Any other relevant information
```

### Suggesting Features

Use the feature request template:

```markdown
**Problem Statement**
What problem does this solve?

**Proposed Solution**
How should it work?

**Alternatives Considered**
Other approaches you've thought about

**Additional Context**
Mockups, examples, etc.
```

## Security Issues

**Do not** open public issues for security vulnerabilities.

Instead:
1. Email security@retailos.com with details
2. Allow 90 days for fix before public disclosure
3. Receive credit in security advisory

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

## Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md` file
- Release notes
- Project README

Thank you for contributing to Retail OS! 🎉
