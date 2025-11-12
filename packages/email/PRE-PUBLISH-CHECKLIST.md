# Pre-Publish Checklist for v0.1.0

Use this checklist before publishing to npm.

## ✅ Code Quality

- [x] All source files written and complete
- [x] TypeScript types fully defined
- [x] All public APIs documented with JSDoc
- [x] Code formatted with Biome
- [x] No linting errors

**Verify:**
```bash
pnpm format
pnpm lint
pnpm typecheck
```

## ✅ Testing

- [x] Unit tests written for all modules
- [x] Integration test suite created
- [x] Unit tests passing
- [x] Test coverage >80%
- [x] Integration tests passing (manual)

**Verify:**
```bash
pnpm test
pnpm test:coverage
```

**Run integration tests manually:**
```bash
export TEST_FROM_EMAIL=your-verified-email@domain.com
export TEST_TO_EMAIL=your-verified-email@domain.com
pnpm test:integration
```

## ✅ Build System

- [x] tsup configured for dual CJS/ESM
- [x] TypeScript compilation working
- [x] Build completes successfully
- [x] Dist files generated correctly

**Verify:**
```bash
pnpm clean
pnpm build
ls -la dist/
# Should see: index.js, index.mjs, index.d.ts, *.map files
```

## ✅ Dependencies

- [x] All dependencies listed in package.json
- [x] Peer dependencies configured correctly
- [x] No critical vulnerabilities
- [x] Dependencies installed successfully

**Verify:**
```bash
pnpm install
pnpm audit
# Fix any critical/high vulnerabilities
```

## ✅ Documentation

- [x] README.md complete with examples
- [x] TESTING.md with testing guide
- [x] BUILD.md with build instructions
- [x] CONTRIBUTING.md with dev workflow
- [x] Examples directory with working examples
- [ ] All examples tested

## ✅ Package Configuration

- [x] package.json name: @wraps.dev/email
- [x] package.json version: 0.2.0
- [x] Correct repository URL
- [x] License specified (MIT)
- [x] Keywords added
- [x] Files field configured
- [x] Exports map configured
- [x] package.json reviewed

**Review package.json:**
```bash
cat package.json
```

## ✅ Git & GitHub

- [ ] All changes committed
- [ ] Code pushed to main branch
- [ ] No uncommitted changes
- [ ] GitHub repo set up correctly

**Verify:**
```bash
git status
git log -1
```

## ✅ npm Publishing

- [ ] Logged into npm (`pnpm login`)
- [ ] Added to @wraps organization
- [ ] pnpm whoami shows correct user
- [ ] Test pack to verify contents

**Verify:**
```bash
pnpm whoami
pnpm pack --dry-run
# Review what files will be published
```

## ✅ Manual Testing

### AWS SES Sandbox Testing

- [ ] AWS SES account set up
- [ ] Email addresses verified in SES
- [ ] Test simple email send
- [ ] Test template creation
- [ ] Test template sending
- [ ] Test bulk template sending
- [ ] Test error handling

See [TESTING.md](./TESTING.md) for detailed instructions.

## ✅ Final Checks

- [ ] Version number correct (0.2.0)
- [ ] Changelog or release notes prepared
- [ ] All TODOs in code addressed or documented
- [ ] No console.log or debug code
- [ ] No hardcoded credentials or secrets

## 🚀 Publishing Commands

Once all checks pass:

### Dry run (recommended first)
```bash
pnpm publish --dry-run --access public
```

### Actual publish
```bash
pnpm publish --access public
```

### Create GitHub release
```bash
git tag email-v0.2.0
git push origin email-v0.2.0
```

Then create release on GitHub: https://github.com/wraps-team/wraps-js/releases/new

## 📋 Post-Publish Verification

After publishing:

- [ ] Package appears on npm: https://www.npmjs.com/package/@wraps.dev/email
- [ ] Install test: `pnpm add @wraps.dev/email` in new directory
- [ ] Import test: `import { WrapsEmail } from '@wraps.dev/email'`
- [ ] Basic functionality test
- [ ] Documentation visible on npm page
- [ ] GitHub release created

## 🎯 Success Criteria

Before marking v0.1.0 as complete:

- ✅ All unit tests passing
- ✅ >80% test coverage
- ✅ Successful integration tests
- ✅ No critical vulnerabilities
- ✅ Clean build output
- ✅ Published to npm
- ✅ GitHub release created
- ✅ Documentation complete

## 📝 Notes

- First publish: Use `pnpm publish --access public` (needed for scoped packages)
- Keep test coverage reports
- Document any issues found during testing
- Update version in package.json before next release

---

**Ready to publish?** Make sure ALL checkboxes are checked before running `pnpm publish`!
