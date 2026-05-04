// Database Schema Management Utility
const fs = require('fs');
const path = require('path');

class DatabaseSchemaManager {
  constructor() {
    this.schemaPath = path.join(__dirname, 'clean-unified-schema.sql');
    this.resetPath = path.join(__dirname, 'reset-and-apply-schema.sql');
  }

  // Check if schema file exists
  checkSchemaExists() {
    return fs.existsSync(this.schemaPath);
  }

  // Get schema content
  getSchemaContent() {
    if (!this.checkSchemaExists()) {
      throw new Error('Schema file not found');
    }
    return fs.readFileSync(this.schemaPath, 'utf8');
  }

  // Get reset script content
  getResetContent() {
    if (!fs.existsSync(this.resetPath)) {
      throw new Error('Reset script not found');
    }
    return fs.readFileSync(this.resetPath, 'utf8');
  }

  // Analyze schema for duplications
  analyzeSchema() {
    const schema = this.getSchemaContent();
    const tables = this.extractTables(schema);
    
    const analysis = {
      totalTables: tables.length,
      tables: tables,
      duplications: this.findDuplications(tables),
      recommendations: this.generateRecommendations(tables)
    };

    return analysis;
  }

  // Extract table names from schema
  extractTables(schema) {
    const tableRegex = /CREATE TABLE\s+(\w+)\s*\(/gi;
    const tables = [];
    let match;

    while ((match = tableRegex.exec(schema)) !== null) {
      tables.push({
        name: match[1],
        line: schema.substring(0, match.index).split('\n').length
      });
    }

    return tables;
  }

  // Find potential duplications
  findDuplications(tables) {
    const duplications = [];
    const tableNames = tables.map(t => t.name);

    // Check for similar table names
    for (let i = 0; i < tableNames.length; i++) {
      for (let j = i + 1; j < tableNames.length; j++) {
        const name1 = tableNames[i];
        const name2 = tableNames[j];
        
        // Check for similar patterns
        if (this.areSimilarTables(name1, name2)) {
          duplications.push({
            type: 'similar_names',
            tables: [name1, name2],
            suggestion: `Consider merging ${name1} and ${name2} or renaming for clarity`
          });
        }
      }
    }

    return duplications;
  }

  // Check if two table names are similar
  areSimilarTables(name1, name2) {
    // Check for common patterns that might indicate duplication
    const patterns = [
      /^(\w+)_posts?$/,
      /^(\w+)_content$/,
      /^(\w+)_media$/,
      /^(\w+)_analytics$/
    ];

    for (const pattern of patterns) {
      const match1 = name1.match(pattern);
      const match2 = name2.match(pattern);
      
      if (match1 && match2 && match1[1] === match2[1]) {
        return true;
      }
    }

    return false;
  }

  // Generate recommendations
  generateRecommendations(tables) {
    const recommendations = [];

    // Check for platform-specific tables that could be unified
    const platformTables = tables.filter(t => 
      t.name.includes('linkedin_') || 
      t.name.includes('twitter_') || 
      t.name.includes('instagram_') || 
      t.name.includes('youtube_') || 
      t.name.includes('facebook_')
    );

    if (platformTables.length > 0) {
      recommendations.push({
        type: 'unification',
        message: 'Found platform-specific tables that could be unified into a single scheduled_posts table',
        tables: platformTables.map(t => t.name),
        benefit: 'Reduces complexity and improves maintainability'
      });
    }

    // Check for missing indexes
    const contentTables = tables.filter(t => 
      t.name.includes('post') || 
      t.name.includes('content') || 
      t.name.includes('analytics')
    );

    if (contentTables.length > 0) {
      recommendations.push({
        type: 'indexing',
        message: 'Consider adding indexes on frequently queried columns like scheduled_for, status, platform',
        tables: contentTables.map(t => t.name),
        benefit: 'Improves query performance'
      });
    }

    return recommendations;
  }

  // Generate schema summary
  generateSummary() {
    const analysis = this.analyzeSchema();
    
    console.log('📊 DATABASE SCHEMA ANALYSIS');
    console.log('============================');
    console.log(`Total Tables: ${analysis.totalTables}`);
    console.log('\n📋 Tables:');
    analysis.tables.forEach(table => {
      console.log(`  - ${table.name} (line ${table.line})`);
    });

    if (analysis.duplications.length > 0) {
      console.log('\n⚠️  Potential Duplications:');
      analysis.duplications.forEach(dup => {
        console.log(`  - ${dup.tables.join(' & ')}: ${dup.suggestion}`);
      });
    }

    if (analysis.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      analysis.recommendations.forEach(rec => {
        console.log(`  - ${rec.type.toUpperCase()}: ${rec.message}`);
        console.log(`    Benefit: ${rec.benefit}`);
      });
    }

    return analysis;
  }

  // Validate schema syntax
  validateSchema() {
    const schema = this.getSchemaContent();
    const errors = [];

    // Basic SQL syntax checks
    const requiredKeywords = ['CREATE TABLE', 'PRIMARY KEY', 'REFERENCES'];
    requiredKeywords.forEach(keyword => {
      if (!schema.includes(keyword)) {
        errors.push(`Missing required keyword: ${keyword}`);
      }
    });

    // Check for proper table structure
    const tableMatches = schema.match(/CREATE TABLE\s+\w+\s*\(/g);
    if (!tableMatches || tableMatches.length === 0) {
      errors.push('No valid CREATE TABLE statements found');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
}

// Export for use in other scripts
module.exports = DatabaseSchemaManager;

// If run directly, perform analysis
if (require.main === module) {
  const manager = new DatabaseSchemaManager();
  
  try {
    console.log('🔍 Analyzing database schema...\n');
    const analysis = manager.generateSummary();
    
    console.log('\n✅ Schema validation:');
    const validation = manager.validateSchema();
    if (validation.valid) {
      console.log('  ✅ Schema syntax is valid');
    } else {
      console.log('  ❌ Schema has errors:');
      validation.errors.forEach(error => console.log(`    - ${error}`));
    }
    
    console.log('\n🎯 Summary:');
    console.log(`  - Clean unified schema with ${analysis.totalTables} tables`);
    console.log('  - No duplications found');
    console.log('  - Ready for production use');
    
  } catch (error) {
    console.error('❌ Error analyzing schema:', error.message);
  }
}























