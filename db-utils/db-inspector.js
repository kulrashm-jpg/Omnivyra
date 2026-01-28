#!/usr/bin/env node

/**
 * DrishiQ Database Inspector
 * Comprehensive utility to inspect database schema and detect duplicates
 * 
 * Usage:
 *   node db-inspector.js                    # Check all tables
 *   node db-inspector.js --table blog_posts # Check specific table
 *   node db-inspector.js --duplicates       # Check for duplicates
 *   node db-inspector.js --help             # Show help
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from parent directory
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    });
  } catch (error) {
    console.error('❌ Error loading .env.local:', error.message);
    process.exit(1);
  }
}

// Load environment variables
loadEnv();

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class DatabaseInspector {
  constructor() {
    this.tables = [];
    this.duplicates = new Map();
    this.cachedTables = null;
    this.cacheTimestamp = 0;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    this.QUERY_TIMEOUT = 10000; // 10 seconds
  }

  // Get all accessible tables using SQL query with caching
  async getAllTables() {
    try {
      // Check cache first
      if (Date.now() - this.cacheTimestamp < this.CACHE_DURATION && this.cachedTables) {
        console.log(`${colors.green}✅ Using cached table list (${this.cachedTables.length} tables)${colors.reset}`);
        this.tables = this.cachedTables;
        return this.tables;
      }

      console.log(`${colors.cyan}🔍 Checking accessible tables...${colors.reset}`);
      
      // Use SQL query to get all tables from information_schema
      const { data, error } = await supabase.rpc('get_all_tables');
      
      if (error) {
        // Fallback: try direct SQL query
        console.log(`${colors.yellow}⚠️  RPC not available, trying direct query...${colors.reset}`);
        
        // Get all tables using a direct query
        const { data: tablesData, error: tablesError } = await supabase
          .from('information_schema.tables')
          .select('table_name')
          .eq('table_schema', 'public')
          .order('table_name');
        
        if (tablesError) {
          console.log(`${colors.yellow}⚠️  Direct query failed, using fallback method...${colors.reset}`);
          return await this.getAllTablesFallback();
        }
        
        const tableNames = tablesData.map(row => row.table_name);
        this.tables = tableNames;
        
        console.log(`${colors.green}✅ Found ${this.tables.length} tables:${colors.reset}`);
        
        // Get row counts for each table in parallel
        const tablePromises = tableNames.slice(0, 20).map(async (tableName) => {
          try {
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Query timeout')), this.QUERY_TIMEOUT)
            );
            
            const queryPromise = supabase
              .from(tableName)
              .select('*', { count: 'exact', head: true });
            
            const { count } = await Promise.race([queryPromise, timeoutPromise]);
            return { name: tableName, count: count || 0 };
          } catch (e) {
            return { name: tableName, count: 'N/A' };
          }
        });
        
        const existingTables = await Promise.all(tablePromises);
        
        existingTables.forEach(table => {
          console.log(`  - ${colors.blue}${table.name}${colors.reset}: ${colors.green}${table.count} rows${colors.reset}`);
        });
        
        if (tableNames.length > 20) {
          console.log(`  ... and ${colors.cyan}${tableNames.length - 20} more tables${colors.reset}`);
        }
        
        // Cache the results
        this.cachedTables = this.tables;
        this.cacheTimestamp = Date.now();
        
        return this.tables;
      }
      
      // If RPC worked
      this.tables = data.map(t => t.table_name);
      console.log(`${colors.green}✅ Found ${this.tables.length} tables via RPC${colors.reset}`);
      
      // Cache the results
      this.cachedTables = this.tables;
      this.cacheTimestamp = Date.now();
      
      return this.tables;
      
    } catch (error) {
      console.error(`${colors.red}❌ Error:${colors.reset}`, error.message);
      return await this.getAllTablesFallback();
    }
  }

  // Fallback method to check common tables (optimized with parallel processing)
  async getAllTablesFallback() {
    console.log(`${colors.yellow}🔄 Using fallback method...${colors.reset}`);
    
    const commonTables = [
      'users', 'campaigns', 'campaign_goals', 'market_analyses', 'content_plans',
      'schedule_reviews', 'ai_threads', 'ai_feedback', 'ai_improvements',
      'campaign_learnings', 'campaign_analytics', 'campaign_performance',
      'api_integrations', 'webhook_logs', 'blog_posts', 'testimonials', 
      'profiles', 'sessions', 'invitations', 'payments', 'subscriptions', 
      'media', 'categories', 'pricing_plans', 'admin_users', 'pricing_tiers'
    ];
    
    // Check tables in parallel
    const tablePromises = commonTables.map(async (table) => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), this.QUERY_TIMEOUT)
        );
        
        const queryPromise = supabase
          .from(table)
          .select('*', { count: 'exact' })
          .limit(1);
        
        const { data, count, error } = await Promise.race([queryPromise, timeoutPromise]);
        
        if (!error) {
          return { name: table, count: count || 0 };
        }
        return null;
      } catch (e) {
        // Table doesn't exist or no access
        return null;
      }
    });

    const results = await Promise.all(tablePromises);
    const existingTables = results.filter(result => result !== null);

    this.tables = existingTables.map(t => t.name);
    console.log(`${colors.green}✅ Found ${this.tables.length} accessible tables:${colors.reset}`);
    existingTables.forEach(table => {
      console.log(`  - ${colors.blue}${table.name}${colors.reset}: ${colors.green}${table.count} rows${colors.reset}`);
    });
    
    // Cache the results
    this.cachedTables = this.tables;
    this.cacheTimestamp = Date.now();
    
    return this.tables;
  }

  // Get detailed schema information for a table (optimized)
  async getTableSchema(tableName) {
    try {
      console.log(`${colors.cyan}\n📋 Analyzing table: ${colors.bright}${tableName}${colors.reset}`);
      
      // Combined query to get both count and sample data
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), this.QUERY_TIMEOUT)
      );
      
      const queryPromise = supabase
        .from(tableName)
        .select('*', { count: 'exact' })
        .limit(3);

      const { data: sample, count, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        console.error(`${colors.red}❌ Error fetching data:${colors.reset}`, error.message);
        return null;
      }

      const schema = {
        tableName,
        columns: sample && sample.length > 0 ? Object.keys(sample[0]) : [],
        rowCount: count || 0,
        sample: sample || []
      };

      this.displayTableSchema(schema);
      return schema;

    } catch (error) {
      console.error(`${colors.red}❌ Error analyzing table ${tableName}:${colors.reset}`, error.message);
      return null;
    }
  }

  // Display table schema in a formatted way
  displayTableSchema(schema) {
    const { tableName, columns, rowCount, sample } = schema;

    console.log(`${colors.bright}\n📊 Table: ${colors.blue}${tableName}${colors.reset}`);
    console.log(`${colors.cyan}📈 Row Count: ${colors.green}${rowCount.toLocaleString()}${colors.reset}`);
    
    if (columns.length > 0) {
      console.log(`${colors.bright}\n📋 Columns (${columns.length}):${colors.reset}`);
      
      // Group columns by type
      const regularCols = columns.filter(col => !col.match(/_([a-z]{2})$/i));
      const translationCols = columns.filter(col => col.match(/_([a-z]{2})$/i));
      
      if (regularCols.length > 0) {
        console.log(`${colors.white}Regular columns:${colors.reset}`);
        regularCols.forEach(col => {
          console.log(`  ${colors.blue}${col}${colors.reset}`);
        });
      }

      if (translationCols.length > 0) {
        console.log(`\n${colors.green}🌐 Translation columns (${translationCols.length}):${colors.reset}`);
        
        // Group by base field
        const translationGroups = new Map();
        translationCols.forEach(col => {
          const match = col.match(/^(.+)_([a-z]{2})$/i);
          if (match) {
            const [, baseField, lang] = match;
            if (!translationGroups.has(baseField)) {
              translationGroups.set(baseField, []);
            }
            translationGroups.get(baseField).push({ lang, col });
          }
        });

        translationGroups.forEach((langs, baseField) => {
          console.log(`\n  ${colors.bright}${baseField}:${colors.reset}`);
          langs.forEach(({ lang, col }) => {
            console.log(`    ${colors.green}${lang}${colors.reset}: ${colors.blue}${col}${colors.reset}`);
          });
        });
      }
    }

    // Show sample data
    if (sample.length > 0) {
      console.log(`${colors.bright}\n📝 Sample data:${colors.reset}`);
      console.log(JSON.stringify(sample[0], null, 2));
    }
  }

  // Check for duplicates in a table (optimized with batch processing)
  async checkDuplicates(tableName, columns = []) {
    try {
      console.log(`${colors.cyan}\n🔍 Checking for duplicates in table: ${colors.bright}${tableName}${colors.reset}`);
      
      if (columns.length === 0) {
        // Get sample data to determine columns
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), this.QUERY_TIMEOUT)
        );
        
        const queryPromise = supabase
          .from(tableName)
          .select('*')
          .limit(1);
        
        const { data: sample, error } = await Promise.race([queryPromise, timeoutPromise]);
        
        if (error) {
          console.error(`${colors.red}❌ Error fetching columns:${colors.reset}`, error.message);
          return;
        }
        
        columns = sample && sample.length > 0 ? Object.keys(sample[0]) : [];
      }

      console.log(`Checking columns: ${colors.blue}${columns.join(', ')}${colors.reset}`);

      // Process data in batches to avoid memory issues
      const BATCH_SIZE = 1000;
      const counts = new Map();
      let offset = 0;
      let hasMoreData = true;

      while (hasMoreData) {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), this.QUERY_TIMEOUT)
        );
        
        const queryPromise = supabase
          .from(tableName)
          .select(columns.join(','))
          .range(offset, offset + BATCH_SIZE - 1);

        const { data: batchData, error } = await Promise.race([queryPromise, timeoutPromise]);

        if (error) {
          console.error(`${colors.red}❌ Error checking duplicates:${colors.reset}`, error.message);
          return;
        }

        if (!batchData || batchData.length === 0) {
          hasMoreData = false;
        } else {
          // Count occurrences in this batch
          batchData.forEach(row => {
            const key = columns.map(col => row[col]).join('|');
            counts.set(key, (counts.get(key) || 0) + 1);
          });

          offset += BATCH_SIZE;
          console.log(`${colors.cyan}📊 Processed ${offset} records...${colors.reset}`);
        }
      }

      // Find actual duplicates
      const duplicateEntries = Array.from(counts.entries())
        .filter(([key, count]) => count > 1)
        .map(([key, count]) => {
          const values = key.split('|');
          return {
            values: columns.reduce((obj, col, index) => {
              obj[col] = values[index];
              return obj;
            }, {}),
            count
          };
        });

      if (duplicateEntries.length === 0) {
        console.log(`${colors.green}✅ No duplicates found!${colors.reset}`);
      } else {
        console.log(`${colors.red}❌ Found ${duplicateEntries.length} duplicate groups:${colors.reset}`);
        duplicateEntries.forEach((entry, index) => {
          console.log(`${colors.yellow}\n${index + 1}. Count: ${entry.count}${colors.reset}`);
          Object.entries(entry.values).forEach(([col, val]) => {
            console.log(`   ${colors.blue}${col}${colors.reset}: ${colors.white}${val}${colors.reset}`);
          });
        });
      }

      return duplicateEntries;

    } catch (error) {
      console.error(`${colors.red}❌ Error checking duplicates:${colors.reset}`, error.message);
      return [];
    }
  }

  // Main execution function (optimized with parallel processing)
  async run(options = {}) {
    console.log(`${colors.bright}${colors.cyan}🔍 DrishiQ Database Inspector${colors.reset}`);
    console.log(`${colors.cyan}================================${colors.reset}\n`);

    try {
      if (options.table) {
        // Check specific table
        console.log(`${colors.yellow}📊 Processing single table...${colors.reset}`);
        await this.getTableSchema(options.table);
        if (options.duplicates) {
          await this.checkDuplicates(options.table);
        }
      } else {
        // Check all tables with parallel processing
        const tables = await this.getAllTables();
        
        if (tables.length === 0) {
          console.log(`${colors.yellow}⚠️  No tables found to analyze${colors.reset}`);
          return;
        }

        console.log(`${colors.yellow}📊 Processing ${tables.length} tables in parallel...${colors.reset}`);
        
        // Process tables in parallel with progress tracking
        const tablePromises = tables.map(async (table, index) => {
          try {
            console.log(`${colors.cyan}⏳ [${index + 1}/${tables.length}] Processing: ${table}${colors.reset}`);
            
            const schema = await this.getTableSchema(table);
            
            if (options.duplicates && schema) {
              await this.checkDuplicates(table);
            }
            
            return schema;
          } catch (error) {
            console.error(`${colors.red}❌ Error processing table ${table}:${colors.reset}`, error.message);
            return null;
          }
        });

        const results = await Promise.all(tablePromises);
        const successfulResults = results.filter(result => result !== null);
        
        console.log(`${colors.green}✅ Successfully processed ${successfulResults.length}/${tables.length} tables${colors.reset}`);
      }

      console.log(`${colors.green}\n✅ Database inspection completed!${colors.reset}`);

    } catch (error) {
      console.error(`${colors.red}❌ Fatal error:${colors.reset}`, error.message);
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    table: null,
    duplicates: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--table' || arg === '-t') {
      options.table = args[i + 1];
      i++; // Skip next argument as it's the table name
    } else if (arg === '--duplicates' || arg === '-d') {
      options.duplicates = true;
    }
  }

  return options;
}

// Show help
function showHelp() {
  console.log(`${colors.bright}DrishiQ Database Inspector${colors.reset}`);
  console.log(`${colors.cyan}==========================${colors.reset}\n`);
  
  console.log(`${colors.bright}Usage:${colors.reset}`);
  console.log(`  node db-inspector.js [options]\n`);
  
  console.log(`${colors.bright}Options:${colors.reset}`);
  console.log(`  ${colors.blue}-h, --help${colors.reset}           Show this help message`);
  console.log(`  ${colors.blue}-t, --table <name>${colors.reset}   Inspect specific table`);
  console.log(`  ${colors.blue}-d, --duplicates${colors.reset}     Check for duplicates\n`);
  
  console.log(`${colors.bright}Examples:${colors.reset}`);
  console.log(`  ${colors.green}node db-inspector.js${colors.reset}                    # Check all tables`);
  console.log(`  ${colors.green}node db-inspector.js --table blog_posts${colors.reset}  # Check specific table`);
  console.log(`  ${colors.green}node db-inspector.js --duplicates${colors.reset}        # Check for duplicates`);
  console.log(`  ${colors.green}node db-inspector.js -t testimonials -d${colors.reset}  # Check testimonials for duplicates`);
}

// Main execution
async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    return;
  }

  const inspector = new DatabaseInspector();
  await inspector.run(options);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = DatabaseInspector;


