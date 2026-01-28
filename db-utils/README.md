# DrishiQ Database Utilities

Database inspection and analysis utilities for the DrishiQ project.

## Files

- **`db-inspector.js`** - Comprehensive database inspector with color-coded output
- **`quick-check.js`** - Simple, fast database checker
- **`package.json`** - Dependencies and scripts

## Usage

### Quick Check
```bash
# List all accessible tables
node quick-check.js

# Check specific table
node quick-check.js blog_posts
```

### Full Inspector
```bash
# Check all tables
node db-inspector.js

# Check specific table
node db-inspector.js --table blog_posts

# Check for duplicates
node db-inspector.js --duplicates

# Check specific table for duplicates
node db-inspector.js --table blog_posts --duplicates

# Show help
node db-inspector.js --help
```

## Features

- 🔍 **Schema Inspection** - View table structure and column information
- 🔄 **Duplicate Detection** - Find duplicate records in tables
- 🌐 **Translation Analysis** - Identify language-specific columns
- 📊 **Data Overview** - Row counts and sample data
- 🎨 **Color-coded Output** - Easy to read formatted results

## Environment

The utilities automatically load environment variables from `../.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Examples

### Check Blog Posts Table
```bash
node db-inspector.js --table blog_posts
```

### Check for Duplicates in Testimonials
```bash
node db-inspector.js --table testimonials --duplicates
```

### Quick Overview
```bash
node quick-check.js
```

## Output

The inspector provides:
- **Table listing** with row counts
- **Column details** including translation columns
- **Duplicate analysis** with detailed breakdown
- **Sample data** preview
- **Translation column grouping** by base field and language


