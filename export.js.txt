// ===== EXPORT MODULE =====
const Export = (() => {

  function init() {
    document.getElementById('exportTxt')?.addEventListener('click', () => exportAs('txt'));
    document.getElementById('exportMd')?.addEventListener('click', () => exportAs('md'));
    document.getElementById('exportHtml')?.addEventListener('click', () => exportAs('html'));
    document.getElementById('exportPdf')?.addEventListener('click', printNote);
    document.getElementById('exportImg')?.addEventListener('click', () => Canvas.exportImage());
    document.getElementById('exportAll')?.addEventListener('click', exportAllNotes);
    document.getElementById('exportBackupBtn')?.addEventListener('click', exportAllNotes);
    document.getElementById('importBackupBtn')?.addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile')?.addEventListener('change', importBackup);
    document.getElementById('clearAllDataBtn')?.addEventListener('click', clearAllData);
  }

  function exportAs(format) {
    const note = Editor.getCurrentNote();
    if (!note) return;

    const title = note.title || 'Untitled';
    const editor = document.getElementById('richEditor');
    const plainText = editor?.innerText || '';
    const htmlContent = editor?.innerHTML || '';

    let content = '';
    let mimeType = 'text/plain';
    let ext = format;

    if (format === 'txt') {
      content = `${title}\n${'='.repeat(title.length)}\n\n${plainText}`;
    } else if (format === 'md') {
      content = htmlToMarkdown(title, htmlContent, note);
    } else if (format === 'html') {
      content = generateHTML(title, htmlContent, note);
      mimeType = 'text/html';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(title)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);

    UI.showToast(`Exported as ${format.toUpperCase()} 📄`);
    UI.closeExportModal();
  }

  function htmlToMarkdown(title, html, note) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const text = temp.innerText;

    let md = `# ${title}\n\n`;
    md += `*Created: ${new Date(note.createdAt).toLocaleDateString()}*  \n`;
    md += `*Modified: ${new Date(note.modifiedAt).toLocaleDateString()}*\n\n`;

    if (note.tags?.length) {
      md += `**Tags:** ${note.tags.map(t => '#' + t.name).join(' ')}\n\n`;
    }

    md += `---\n\n${text}`;

    if (note.checklist?.length) {
      md += `\n\n## Checklist\n\n`;
      note.checklist.forEach(item => {
        md += `- [${item.done ? 'x' : ' '}] ${item.text}\n`;
      });
    }

    return md;
  }

  function generateHTML(title, content, note) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - NoteMax</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 60px auto; padding: 0 20px; color: #111; line-height: 1.7; }
    h1 { font-size: 2em; margin-bottom: 0.2em; }
    .meta { color: #888; font-size: 0.9em; margin-bottom: 1.5em; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 1em; }
    .tag { padding: 2px 10px; border-radius: 20px; font-size: 12px; color: white; font-weight: 500; }
    hr { border: none; border-top: 2px solid #eee; margin: 1.5em 0; }
    .checklist { margin-top: 2em; }
    .check-item { display: flex; gap: 10px; align-items: center; padding: 6px 0; }
    .check-item.done span { text-decoration: line-through; color: #999; }
    img { max-width: 100%; border-radius: 8px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    Created: ${new Date(note.createdAt).toLocaleDateString()} &nbsp;·&nbsp;
    Modified: ${new Date(note.modifiedAt).toLocaleDateString()}
  </div>
  ${note.tags?.length ? `<div class="tags">${note.tags.map(t =>
    `<span class="tag" style="background:${t.color}">#${t.name}</span>`).join('')}
  </div>` : ''}
  <hr/>
  <div class="content">${content}</div>
  ${note.checklist?.length ? `
  <div class="checklist">
    <h2>Checklist</h2>
    ${note.checklist.map(item =>
      `<div class="check-item ${item.done ? 'done' : ''}">
        <span>${item.done ? '✅' : '⬜'}</span>
        <span>${item.text}</span>
      </div>`
    ).join('')}
  </div>` : ''}
</body>
</html>`;
  }

  function printNote() {
    window.print();
    UI.closeExportModal();
  }

  async function exportAllNotes() {
    const notes = await DB.getAll(DB.STORES.NOTES);
    const folders = await DB.getAll(DB.STORES.FOLDERS);
    const tags = await DB.getAll(DB.STORES.TAGS);

    const backup = {
      app: 'NoteMax',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      notes,
      folders,
      tags
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notemax-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    UI.showToast('All notes exported! 📦');
    UI.closeExportModal();
    document.getElementById('settingsModal').classList.add('hidden');
  }

  async function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const backup = JSON.parse(ev.target.result);

        if (backup.app !== 'NoteMax') {
          UI.showToast('Invalid backup file ❌');
          return;
        }

        if (!confirm(`Import ${backup.notes?.length} notes? This will add to existing notes.`)) return;

        for (const note of backup.notes || []) {
          await DB.put(DB.STORES.NOTES, note);
        }
        for (const folder of backup.folders || []) {
          await DB.put(DB.STORES.FOLDERS, folder);
        }
        for (const tag of backup.tags || []) {
          await DB.put(DB.STORES.TAGS, tag);
        }

        UI.showToast(`Imported ${backup.notes?.length} notes! ✅`);
        NoteApp.refreshAll();
      } catch (err) {
        UI.showToast('Failed to import backup ❌');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function clearAllData() {
    if (!confirm('Delete ALL notes, folders, and tags? This cannot be undone!')) return;
    if (!confirm('Are you absolutely sure? All data will be permanently deleted.')) return;

    await DB.clear(DB.STORES.NOTES);
    await DB.clear(DB.STORES.FOLDERS);
    await DB.clear(DB.STORES.TAGS);

    UI.showToast('All data cleared 🗑');
    Editor.closeEditor();
    NoteApp.refreshAll();
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 60);
  }

  return { init };
})();