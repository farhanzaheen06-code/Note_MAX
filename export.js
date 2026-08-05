// ===== EXPORT - PEN DRAWING ONLY =====
const Export = (() => {
  function init() {
    document.getElementById('exportImg')?.addEventListener('click', () => {
      Canvas.exportImage();
      UI.closeExportModal();
    });
    document.getElementById('exportPdf')?.addEventListener('click', printNote);
    document.getElementById('exportAll')?.addEventListener('click', exportAllNotes);
    document.getElementById('exportBackupBtn')?.addEventListener('click', exportAllNotes);
    document.getElementById('importBackupBtn')?.addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile')?.addEventListener('change', importBackup);
    document.getElementById('clearAllDataBtn')?.addEventListener('click', clearAllData);
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
      version: '4.0',
      exportedAt: new Date().toISOString(),
      notes, folders, tags
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notemax-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.showToast('Exported! 📦');
    UI.closeExportModal();
    document.getElementById('settingsModal')?.classList.add('hidden');
  }

  async function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (backup.app !== 'NoteMax') { UI.showToast('Invalid file ❌'); return; }
        if (!confirm(`Import ${backup.notes?.length} notes?`)) return;
        for (const note of backup.notes || []) await DB.put(DB.STORES.NOTES, note);
        for (const folder of backup.folders || []) await DB.put(DB.STORES.FOLDERS, folder);
        for (const tag of backup.tags || []) await DB.put(DB.STORES.TAGS, tag);
        UI.showToast(`Imported ${backup.notes?.length} notes! ✅`);
        NoteApp.refreshAll();
      } catch (err) {
        UI.showToast('Import failed ❌');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function clearAllData() {
    if (!confirm('Delete ALL data? Cannot be undone!')) return;
    if (!confirm('Are you sure?')) return;
    await DB.clear(DB.STORES.NOTES);
    await DB.clear(DB.STORES.FOLDERS);
    await DB.clear(DB.STORES.TAGS);
    UI.showToast('All data cleared');
    Editor.closeEditor();
    NoteApp.refreshAll();
  }

  return { init };
})();
