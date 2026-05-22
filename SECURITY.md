# Security Policy

## Reporting Security Issues

If you discover a security vulnerability in this repository, **please do not open a public issue**. Instead:

1. Email security concerns to the repository owner
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Personal Data & Secrets Prevention

This repository includes automated safeguards to prevent accidental commits of:

- **Personal file paths** (`C:/Users/`, `/Users/`, `/home/`)
- **Environment variables** with sensitive values (API keys, tokens, passwords)
- **Private keys** and certificates
- **Database credentials**
- **Usernames and account identifiers**

### Tools in Place

| Tool | Purpose | When It Runs |
|------|---------|--------------|
| `.git-hooks/pre-commit` | Local validation before commit | Pre-commit (locally) |
| `.github/workflows/sanitize-secrets.yml` | Server-side detection & auto-sanitize | Push & Pull Request |
| GitHub Secret Scanning | Detects verified credential patterns | Every push |
| `.gitignore` | Prevents sensitive files from tracking | Git add/commit |

### Setup Instructions

#### Enable Pre-commit Hook Locally

```bash
# Copy hook to your local git config
cp .git-hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# (Optional) Set globally across all your repos
git config --global core.hooksPath ~/.git-hooks
cp .git-hooks/pre-commit ~/.git-hooks/pre-commit
chmod +x ~/.git-hooks/pre-commit
```

#### Enable GitHub Secret Scanning

1. Go to **Settings → Code security & analysis**
2. Enable **Secret scanning** ✓
3. Enable **Push protection** ✓ (blocks commits with verified secrets)

### What Gets Blocked

**Pre-commit Hook** blocks commits containing:
```
C:/Users/saqib/...
/Users/john/...
password = "..."
api_key = "..."
CHAT_API_KEY = ...
-----BEGIN PRIVATE KEY-----
```

**GitHub Workflow** blocks PRs/pushes with:
- High-entropy strings (likely base64 secrets)
- Hardcoded usernames in file paths
- Common credential patterns
- Private key headers

**Auto-Sanitize** on push:
- Replaces `C:/Users/username/` → `/absolute/path/to/`
- Replaces `/Users/username/` → `/absolute/path/to/`
- Replaces `/home/username/` → `/home/user/`
- Commits cleanup automatically

### Best Practices

1. **Never commit**:
   ```bash
   ❌ API keys, tokens, passwords
   ❌ Private keys (.pem, .key files)
   ❌ Local file paths with usernames
   ❌ Database credentials
   ❌ AWS/GCP service account keys
   ```

2. **Use instead**:
   ```bash
   ✅ Environment variables (.env.local, not committed)
   ✅ Wrangler secrets (wrangler secret put KEY)
   ✅ GitHub Secrets (Settings → Secrets)
   ✅ Parameter Store / Secrets Manager
   ✅ Generic placeholder paths in docs
   ```

3. **Template for docs**:
   ```bash
   # ❌ BAD - Hardcoded path
   "args": ["node", "C:/Users/john/projects/fe-engineer/mcp/server.ts"]
   
   # ✅ GOOD - Generic template
   "args": ["node", "/absolute/path/to/fe-engineer/mcp/server.ts"]
   ```

### If Secrets Are Accidentally Committed

1. **Local commit (not pushed)**:
   ```bash
   git reset HEAD~1
   # Remove sensitive data
   git add -A
   git commit -m "fix: remove sensitive data"
   ```

2. **Already pushed**:
   - Contact repo owner immediately
   - Use `git filter-repo` or `BFG Repo-Cleaner` to remove from history
   - Regenerate any exposed credentials
   - Notify affected services

3. **On GitHub**:
   - Go to **Settings → Code security & analysis → Secret scanning**
   - Revoke any leaked credentials immediately
   - Check alert history

### Continuous Monitoring

This repo automatically:
- Scans every push with TruffleHog (entropy-based detection)
- Checks against known credential patterns
- Comments on suspicious PRs
- Auto-sanitizes hardcoded paths

### Questions?

Refer to:
- [GitHub Secret Scanning Docs](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning)
- [TruffleHog Patterns](https://github.com/trufflesecurity/trufflehog)
- This repo's `.github/workflows/sanitize-secrets.yml`
