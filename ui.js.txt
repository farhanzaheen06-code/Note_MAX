// ===== UI MODULE =====
const UI = (() => {
  let toastTimer = null;

  function init() {
    setupSidebar();
    setupModals();
    setupTheme();
    setupSettings();
  }

  // ===== SIDEBAR =====
  function setupSidebar() {
    document.getElementById('toggleSidebarBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
  }

  // ===== MODALS =====
  function setupModals() {
    // Tag Modal
    document.getElementById('closeTagModal')?.addEventListener('click', () => {
      document.getElementById('tagModal').classList.add('hidden');
    });

    document.getElementById('tagModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('tagModal'))
        document.getElementById('tagModal').classList.add('hidden');
    });

    document.getElementById('createTagBtn')?.addEventListener('click', createTag);
    document.getElementById('newTagInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') createTag();
    });

    // Folder Modal
    document.getElementById('closeFolderModal')?.addEventListener('click', () => {
      document.getElementById('folderModal').classList.add('hidden');
    });

    document.getElementById('folderModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('folderModal'))
        document.getElementById('folderModal').classList.add('hidden');
    });

    document.getElementById('addFolderBtn')?.addEventListener('click', showFolderModal);
    document.getElementById('createFolderBtn')?.addEventListener('click', createFolder);

    // Export Modal
    document.getElementById('closeExportModal')?.addEventListener('click', closeExportModal);
    document.getElementById('exportModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('exportModal')) closeExportModal();
    });

    // Settings Modal
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('hidden');
    });

    document.getElementById('closeSettingsModal')?.addEventListener('click', () => {
      document.getElementById('settingsModal').classList.add('hidden');
    });

    document.getElementById('settingsModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('settingsModal'))
        document.getElementById('settingsModal').classList.add('hidden');
    });
  }

  // ===== THEME =====
  function setupTheme() {
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const body = document.body;
      if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        body.classList.add('sepia-mode');
        DB.setSetting('theme', 'sepia');
      } else if (body.classList.contains('sepia-mode')) {
        body.classList.remove('sepia-mode');
        DB.setSetting('theme', 'light');
      } else {
        body.classList.add('dark-mode');
        DB.setSetting('theme', 'dark');
      }
    });

    document.getElementById('themeSelect')?.addEventListener('change', e => {
      applyTheme(e.target.value);
      DB.setSetting('theme', e.target.value);
    });

    document.getElementById('accentColorPicker')?.addEventListener('input', e => {
      document.documentElement.style.setProperty('--accent', e.target.value);
      const darkened = darkenColor(e.target.value, 20);
      document.documentElement.style.setProperty('--accent-dark', darkened);
      DB.setSetting('accentColor', e.target.value);
    });

    document.getElementById('globalFontSize')?.addEventListener('input', e => {
      const size = e.target.value;
      document.documentElement.style.setProperty('--font-size', size + 'px');
      document.getElementById('fontSizeDisplay').textContent = size + 'px';
      DB.setSetting('fontSize', size);
    });
  }

  function applyTheme(theme) {
    document.body.classList.remove('dark-mode', 'sepia-mode', 'midnight-mode');
    if (theme === 'dark') document.body.classList.add('dark-mode');
    else if (theme === 'sepia') document.body.classList.add('sepia-mode');
    else if (theme === 'midnight') document.body.classList.add('midnight-mode');

    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = theme;
  }

  async function loadSavedTheme() {
    const theme = await DB.getSetting('theme', 'light');
    const accent = await DB.getSetting('accentColor', '#6366f1');
    const fontSize = await DB.getSetting('fontSize', 16);

    applyTheme(theme);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-dark', darkenColor(accent, 20));
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');

    const accentPicker = document.getElementById('accentColorPicker');
    if (accentPicker) accentPicker.value = accent;
    const fontSlider = document.getElementById('globalFontSize');
    if (fontSlider) { fontSlider.value = fontSize; }
    const fontDisplay = document.getElementById('fontSizeDisplay');
    if (fontDisplay) fontDisplay.textContent = fontSize + 'px';
  }

  // ===== SETTINGS =====
  function setupSettings() {
    document.getElementById('spellcheckToggle')?.addEventListener('change', e => {
      document.getElementById('richEditor').spellcheck = e.target.checked;
    });
  }

  // ===== FOLDER MODAL =====
  const folderIcons = ['📁', '⭐', '📚', '💼', '🏠', '🎨', '🔬', '🎵', '✈️', '❤️', '🔥', '💡'];
  const folderColors = ['#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6'];
  let selectedFolderIcon = '📁';
  let selectedFolderColor = '#6366f1';

  function showFolderModal() {
    selectedFolderIcon = '📁';
    selectedFolderColor = '#6366f1';

    const iconOpts = document.getElementById('folderIconOptions');
    iconOpts.innerHTML = '';
    folderIcons.forEach(icon => {
      const btn = document.createElement('button');
      btn.className = 'icon-option' + (icon === selectedFolderIcon ? ' selected' : '');
      btn.textContent = icon;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.icon-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedFolderIcon = icon;
      });
      iconOpts.appendChild(btn);
    });

    const colorOpts = document.getElementById('folderColorOptions');
    colorOpts.innerHTML = '';
    folderColors.forEach(color => {
      const btn = document.createElement('button');
      btn.className = 'color-option' + (color === selectedFolderColor ? ' selected' : '');
      btn.style.background = color;
      btn.title = color;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedFolderColor = color;
      });
      colorOpts.appendChild(btn);
    });

    document.getElementById('folderNameInput').value = '';
    document.getElementById('folderModal').classList.remove('hidden');
    document.getElementById('folderNameInput').focus();
  }

  async function createFolder() {
    const name = document.getElementById('folderNameInput').value.trim();
    if (!name) { showToast('Please enter a folder name'); return; }

    const folder = {
      id: Date.now().toString(),
      name,
      icon: selectedFolderIcon,
      color: selectedFolderColor,
      createdAt: Date.now()
    };

    await DB.put(DB.STORES.FOLDERS, folder);
    document.getElementById('folderModal').classList.add('hidden');
    showToast(`Folder "${name}" created 📁`);
    NoteApp.refreshFolders();
  }

  // ===== TAG MODAL =====
  function showTagModal() {
    const currentNote = Editor.getCurrentNote();
    renderTagSelector(currentNote?.tags || []);
    document.getElementById('tagModal').classList.remove('hidden');
  }

  async function renderTagSelector(currentTags) {
    const tags = await DB.getAll(DB.STORES.TAGS);
    const container = document.getElementById('tagSelector');
    container.innerHTML = '';

    if (tags.length === 0) {
      container.innerHTML = '<p style="color:var(--text2);font-size:13px;">No tags yet. Create one below.</p>';
    }

    tags.forEach(tag => {
      const isSelected = currentTags.some(t => t.id === tag.id);
      const btn = document.createElement('button');
      btn.className = 'tag-option' + (isSelected ? ' selected' : '');
      btn.style.background = tag.color;
      btn.textContent = '#' + tag.name;
      btn.dataset.id = tag.id;

      btn.addEventListener('click', async () => {
        const note = Editor.getCurrentNote();
        if (!note) return;

        if (!note.tags) note.tags = [];

        const idx = note.tags.findIndex(t => t.id === tag.id);
        if (idx > -1) {
          note.tags.splice(idx, 1);
          btn.classList.remove('selected');
        } else {
          note.tags.push(tag);
          btn.classList.add('selected');
        }

        Editor.updateNoteTags(note.tags);
        NoteApp.refreshNoteList();
      });

      container.appendChild(btn);
    });
  }

  async function createTag() {
    const name = document.getElementById('newTagInput').value.trim();
    if (!name) return;
    const color = document.getElementById('newTagColor').value;

    const tag = {
      id: Date.now().toString(),
      name: name.replace(/^#/, ''),
      color,
      createdAt: Date.now()
    };

    await DB.put(DB.STORES.TAGS, tag);
    document.getElementById('newTagInput').value = '';
    showToast(`Tag "#${tag.name}" created 🏷️`);

    const note = Editor.getCurrentNote();
    renderTagSelector(note?.tags || []);
    NoteApp.refreshTags();
  }

  // ===== EXPORT MODAL =====
  function showExportModal() {
    document.getElementById('exportModal').classList.remove('hidden');
  }

  function closeExportModal() {
    document.getElementById('exportModal').classList.add('hidden');
  }

  // ===== TOAST =====
  function showToast(message, duration = 2500) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ===== HELPER =====
  function darkenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xFF) - amount);
    const b = Math.max(0, (num & 0xFF) - amount);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  return {
    init, showToast, showTagModal, showExportModal,
    closeExportModal, loadSavedTheme, applyTheme
  };
})();