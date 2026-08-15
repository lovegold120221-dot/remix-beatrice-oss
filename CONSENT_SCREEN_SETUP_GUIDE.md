# Google OAuth Consent Screen Setup for Beatrice

## Overview
This guide explains how to configure the Google OAuth consent screen for the Beatrice app. The consent screen is what users see when they grant permission for your app to access their Google data.

## Required Configuration (Google Cloud Console)

### 1. Navigate to Consent Screen
Go to: Google Cloud Console → APIs & Services → OAuth consent screen

### 2. App Settings
Fill in these fields:

| Field | Value |
|-------|-------|
| **App name** | Beatrice |
| **User support email** | emilalvaroserrano@gmail.com |
| **App logo** | Upload your logo file (PNG, max 1MB) |
| **App domain** | https://oss.eburon.ai |
| **Application home page** | https://oss.eburon.ai/ |
| **Application privacy policy link** | https://oss.eburon.ai/privacy |
| **Application Terms of Service link** | https://oss.eburon.ai/terms/ |

### 3. After Configuration
- If your app is in **Testing** mode: Add your Google test user emails
- If your app is in **Production**: Submit for verification
- The logo must be uploaded before submission for verification

### 4. Scopes Configuration
Ensure these Google Workspace scopes are added (from `src/lib/firebase.ts`):
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/forms.info`
- `https://www.googleapis.com/auth/spreadsheets.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/tasks.readonly`
- `https://www.googleapis.com/auth/contacts.readonly`

### 5. Save and Test
- Click **Save**
- Use the **Test tools** → **Test users** to verify the consent screen
- Add your Google account as a test user if in Testing mode

### Logo Requirements
- Format: PNG, JPG, or SVG
- Maximum size: 1MB
- Recommended dimensions: 256x256 pixels
- Must be original artwork (not generic icons)
- After upload, you'll need to submit for verification unless in Testing mode

### Important Notes
- The **App domain** (`https://oss.eburon.ai`) is critical - Google only allows OAuth apps to use authorized domains
- Users will see your **App name** and **Support email** on the consent screen
- The **App logo** helps users recognize your app
- All links (home page, privacy policy, terms) must be reachable and return valid content
- If the app remains in **Testing** status, only test users can consent
- For production use, you must submit for verification

### Already Configured in This Project
- OAuth client ID: `112636717363-kddlfhhkt7thu52uthgdn0eda3l5pa58.apps.googleusercontent.com`
- Project ID: `beatrice-os`
- Redirected URIs configured for the application

### Next Steps
1. Upload your app logo to the Google Cloud Console
2. Fill in all the branding fields above
3. Add your Google test user emails (if in Testing mode)
4. Submit for verification (if moving to Production)
5. Test the OAuth flow end-to-end

### Files Modified
- `/root/remix-beatrice-oss/config/consent-screen-config.json` - Configuration document
- *Note: Actual Google Cloud Console settings must be configured via the web interface*
