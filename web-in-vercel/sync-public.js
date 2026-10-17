const fs = require('fs');
const path = require('path');

const copy = (src, dest) => {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
};

// 1. Sync batch-studio.html aliases for Vercel cleanUrls
copy(path.join(__dirname, 'batch-studio', 'index.html'), path.join(__dirname, 'batch-studio.html'));
copy(path.join(__dirname, 'batch-studio', 'index.html'), path.join(__dirname, 'public', 'batch-studio.html'));

// 2. Sync main index.html
copy(path.join(__dirname, 'index.html'), path.join(__dirname, 'public', 'index.html'));

// 3. Sync batch-studio folder
copy(path.join(__dirname, 'batch-studio', 'index.html'), path.join(__dirname, 'public', 'batch-studio', 'index.html'));
copy(path.join(__dirname, 'batch-studio', 'style.css'), path.join(__dirname, 'public', 'batch-studio', 'style.css'));
copy(path.join(__dirname, 'batch-studio', 'app.js'), path.join(__dirname, 'public', 'batch-studio', 'app.js'));

// 4. Sync assets & libraries
copy(path.join(__dirname, 'assets', 'ico', 'web.png'), path.join(__dirname, 'public', 'assets', 'ico', 'web.png'));
copy(path.join(__dirname, 'assets', 'ico', 'web.ico'), path.join(__dirname, 'public', 'assets', 'ico', 'web.ico'));
copy(path.join(__dirname, 'js', 'jszip.min.js'), path.join(__dirname, 'public', 'js', 'jszip.min.js'));

console.log('✅ Synchronized all files and aliases to public/ for Vercel deployment');
