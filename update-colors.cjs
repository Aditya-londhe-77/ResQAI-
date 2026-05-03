const fs = require('fs');

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  const replacements = [
    { regex: /#7C3AED/g, replacement: 'var(--primary)' },
    { regex: /rgba\(124,58,237,0\.12\)/g, replacement: 'var(--primary-light)' },
    { regex: /rgba\(124,58,237,0\.04\)/g, replacement: 'var(--bg-hover)' },
    { regex: /var\(--severity-critical\)/g, replacement: 'var(--danger)' },
    { regex: /var\(--severity-medium\)/g, replacement: 'var(--warning)' },
    { regex: /var\(--severity-low\)/g, replacement: 'var(--success)' },
    { regex: /#EF4444/g, replacement: 'var(--danger)' },
    { regex: /rgba\(239,68,68,0\.3\)/g, replacement: 'var(--danger-light)' },
    { regex: /rgba\(239,68,68,0\.08\)/g, replacement: 'var(--danger-light)' },
    { regex: /rgba\(239,68,68,0\.25\)/g, replacement: 'var(--danger)' },
    { regex: /#F97316/g, replacement: 'var(--warning)' },
    { regex: /rgba\(249,115,22,0\.3\)/g, replacement: 'var(--warning-light)' },
    { regex: /#10B981/g, replacement: 'var(--success)' },
    { regex: /#059669/g, replacement: 'var(--success)' },
    { regex: /rgba\(16,185,129,0\.25\)/g, replacement: 'var(--success-light)' },
    { regex: /#8B5CF6/g, replacement: 'var(--primary)' },
    { regex: /#475569/g, replacement: 'var(--text-muted)' },
    { regex: /#64748B/g, replacement: 'var(--text-muted)' },
    { regex: /#94A3B8/g, replacement: 'var(--text-muted)' },
    { regex: /#0F172A/g, replacement: 'var(--ink)' },
    { regex: /#1E293B/g, replacement: 'var(--ink)' },
    { regex: /#374151/g, replacement: 'var(--text-body)' },
    { regex: /#E0F2FE/g, replacement: 'var(--primary-light)' },
    { regex: /#BAE6FD/g, replacement: 'var(--border)' },
    { regex: /#fff/gi, replacement: 'var(--text-light)' },
    { regex: /#ffffff/gi, replacement: 'var(--text-light)' },
    { regex: /#F1F5F9/gi, replacement: 'var(--bg-surface)' },
    { regex: /rgba\(109,40,217,0\.07\)/gi, replacement: 'var(--bg-surface)' },
    { regex: /rgba\(79,70,229,0\.05\)/gi, replacement: 'var(--bg-surface)' },
    { regex: /rgba\(124,58,237,0\.25\)/gi, replacement: 'var(--border)' },
    { regex: /rgba\(0,0,0,0\.04\)/gi, replacement: 'var(--bg-surface)' }
  ];

  for (const { regex, replacement } of replacements) {
    content = content.replace(regex, replacement);
  }

  // Also apply serif headers class to specific elements
  content = content.replace(/<h([1-6])/g, (match, p1) => {
    return `<h${p1} style={{ fontFamily: 'var(--font-serif)' }}`;
  });
  
  // Combine multiple styles into one
  content = content.replace(/style=\{\{\s*fontFamily:\s*'var\(--font-serif\)'\s*\}\}\s*style=\{\{/g, 'style={{ fontFamily: \'var(--font-serif)\', ');

  // Update NGO self-assign button in Dashboard.jsx to optimistic label logic if possible
  // Just checking if we can replace 'Self-Assign' with a dynamic check, but for now we'll just keep the class updates.

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated ' + filePath);
}

updateFile('src/pages/Dashboard.jsx');
updateFile('src/pages/AdminDashboard.jsx');
