# SICTADAU - Vercel Deployment Guide

## Project Status
✅ **Git Repository Initialized**
✅ **vercel.json Created**
✅ **.gitignore Configured**
✅ **Ready for Deployment**

## Deployment Options

### Option 1: Deploy via Vercel Web (Easiest)

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Sign in to your Vercel account

2. **Add New Project**
   - Click "Add New..." → "Project"
   - Select "Import Git Repository"
   - Or paste your GitHub repository URL

3. **Configure Project**
   - Project Name: `sictadau`
   - Framework Preset: `Other` (Node.js)
   - Root Directory: `.` (current directory)

4. **Environment Variables**
   - Add the following in Vercel dashboard:
     ```
     DATABASE_PATH=./database/sictadau.db
     SESSION_SECRET=your-secret-key-here
     NODE_ENV=production
     ```

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete

---

### Option 2: Deploy via Vercel CLI (Recommended)

1. **Install Vercel CLI on Your Machine**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy from Project Root**
   ```bash
   cd /Users/venkateshage/sictadau
   vercel
   ```

4. **Follow Interactive Prompts**
   - Set project name: `sictadau`
   - Confirm framework detection: `Other`
   - Configure environment variables when prompted

---

### Option 3: Deploy via Git Push (Requires Git Integration)

1. **Create GitHub Repository**
   - Go to https://github.com/new
   - Create new repository: `sictadau`

2. **Push Current Code**
   ```bash
   git remote add origin https://github.com/your-username/sictadau.git
   git branch -M main
   git push -u origin main
   ```

3. **Link to Vercel**
   - Go to https://vercel.com/new
   - Import GitHub repository
   - Vercel will auto-deploy on each push

---

## Important Notes

⚠️ **Database Persistence**
- SQLite databases on Vercel are ephemeral (files are deleted between deployments)
- For production, consider:
  - Using a persistent database service (PostgreSQL, MongoDB)
  - Or implementing a backup/restore mechanism

⚠️ **Environment Variables**
- Never commit `.env` files
- All sensitive data should be set in Vercel dashboard

⚠️ **File Uploads**
- Uploaded files are temporary on Vercel
- Use cloud storage (AWS S3, Cloudinary, etc.) for persistence

---

## Post-Deployment

1. **Test Your Application**
   - Access your Vercel deployment URL
   - Test login functionality
   - Verify database operations

2. **Configure Custom Domain (Optional)**
   - In Vercel dashboard → Project Settings → Domains
   - Add your custom domain

3. **Enable Analytics (Optional)**
   - Vercel provides free analytics
   - Available in project dashboard

---

## Troubleshooting

**Build Fails**
- Check build logs in Vercel dashboard
- Ensure all dependencies are in package.json
- Verify Node.js version compatibility

**Database Errors**
- Check if DATABASE_PATH environment variable is set
- Verify database file exists in deployment

**Timeout Issues**
- Vercel has 60-second default timeout
- Configure in vercel.json if needed

---

## Current Git Status

```
Repository: Initialized ✓
Remote: Not yet configured
Branch: main
Commits: 1 (Initial commit)
Files: 71 tracked
```

## Next Steps

1. Choose a deployment option above
2. Configure environment variables
3. Deploy to Vercel
4. Test application
5. Monitor in Vercel dashboard
