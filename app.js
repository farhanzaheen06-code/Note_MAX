// ===== MAIN APP =====
const NoteApp = (() => {
  let allNotes = [];
  let allFolders = [];
  let allTags = [];
  let currentFilter = 'all';
  let currentFolderId = null;
  let currentTagId = null;
  let searchQuery = '';
  let sortBy = 'modified';

  async function init() {
    await DB.open();
    UI.init();
    Editor.init();
    Canvas.init();
    Export.init();
    await UI.loadSavedTheme();
    await loadData();
    setupSidebarToggles();
    setupNewNote();
    setupFilters();
    setupSearch();
    setupSort();
    document.getElementById('emptyNewBtn')?.addEventListener('click', createNewNote);
    document.getElementById('emptyBrowseBtn')?.addEventListener('click', showNoteList);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  async function loadData() {
    await Promise.all([refreshNoteList(), refreshFolders(), refreshTags()]);
  }

  // ===== SIDEBAR TOGGLES =====
  function setupSidebarToggles() {
    document.getElementById('menuBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
    document.getElementById('notesBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNoteList();
    });
    document.getElementById('closeSidebarBtn')?.addEventListener('click', () => {
      document.body.classList.add('sidebar-hidden');
      updateBackdrop();
    });
    document.getElementById('closeNoteListBtn')?.addEventListener('click', () => {
      document.body.classList.add('notelist-hidden');
      updateBackdrop();
    });
    document.getElementById('backdrop')?.addEventListener('click', () => {
      document.body.classList.add('sidebar-hidden');
      document.body.classList.add('notelist-hidden');
      updateBackdrop();
    });
  }

  function toggleSidebar() {
    document.body.classList.toggle('sidebar-hidden');
    updateBackdrop();
  }

  function toggleNoteList() {
    document.body.classList.toggle('notelist-hidden');
    updateBackdrop();
  }

  function showNoteList() {
    document.body.classList.remove('notelist-hidden');
    updateBackdrop();
  }

  function updateBackdrop() {
    const bd = document.getElementById('backdrop');
    if (!bd) return;
    const showBackdrop = !document.body.classList.contains('sidebar-hidden') ||
                         !document.body.classList.contains('notelist-hidden');
    bd.classList.toggle('hidden', !showBackdrop);
  }

  // ===== NEW NOTE =====
  function setupNewNote() {
    document.getElementById('newNoteBtn')?.addEventListener('click', createNewNote);
  }

  async function createNewNote() {
    const note = {
      id: Date.now().toString(),
      title: '',
      content: '',
      checklist: [],
      strokes: [],
      tags: [],
      folderId: currentFolderId,
      pinned: false,
      favorite: false,
      trashed: false,
      createdAt: Date.now(),
      modifiedAt: Date.now()
    };
    await DB.put(DB.STORES.NOTES, note);
    await refreshNoteList();
    openNote(note);
    document.body.classList.add('notelist-hidden');
    document.body.classList.add('sidebar-hidden');
    updateBackdrop();
    setTimeout(() => document.getElementById('titleInput')?.focus(), 100);
  }

  function openNote(note) {
    Editor.loadNote(note);
    document.querySelectorAll('.note-item').forEach(item => {
      item.classList.toggle('active', item.dataset.id === note.id);
    });
  }

  // ===== FILTERS =====
  function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        currentFolderId = null;
        currentTagId = null;
        document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
        document.querySelectorAll('.tag-pill').forEach(t => t.classList.remove('active'));
        refreshNoteList();
        updateNoteListTitle();
      });
    });
  }

  function setupSearch() {
    document.getElementById('searchInput')?.addEventListener('input', e => {
      searchQuery = e.target.value.toLowerCase();
      refreshNoteList();
    });
  }

  function setupSort() {
    document.getElementById('sortBtn')?.addEventListener('click', () => {
      document.getElementById('sortDropdown').classList.toggle('hidden');
    });
    document.querySelectorAll('.sort-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sortBy = btn.dataset.sort;
        document.getElementById('sortDropdown').classList.add('hidden');
        refreshNoteList();
      });
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#sortBtn') && !e.target.closest('#sortDropdown')) {
        document.getElementById('sortDropdown')?.classList.add('hidden');
      }
    });
  }

  async function refreshNoteList() {
    allNotes = await DB.getAll(DB.STORES.NOTES);
    let filtered = allNotes;

    switch (currentFilter) {
      case 'pinned': filtered = filtered.filter(n => n.pinned && !n.trashed); break;
      case 'favorites': filtered = filtered.filter(n => n.favorite && !n.trashed); break;
      case 'trash': filtered = filtered.filter(n => n.trashed); break;
      default: filtered = filtered.filter(n => !n.trashed);
    }

    if (currentFolderId) filtered = filtered.filter(n => n.folderId === currentFolderId);
    if (currentTagId) filtered = filtered.filter(n => n.tags?.some(t => t.id === currentTagId));

    if (searchQuery) {
      filtered = filtered.filter(n =>
        (n.title || '').toLowerCase().includes(searchQuery) ||
        getPlainText(n.content || '').toLowerCase().includes(searchQuery) ||
        n.tags?.some(t => t.name.toLowerCase().includes(searchQuery))
      );
    }

    filtered.sort((a, b) => {
      if (sortBy === 'modified') return b.modifiedAt - a.modifiedAt;
      if (sortBy === 'created') return b.createdAt - a.createdAt;
      if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'title-desc') return (b.title || '').localeCompare(a.title || '');
      return 0;
    });

    if (currentFilter === 'all') {
      const pinned = filtered.filter(n => n.pinned);
      const unpinned = filtered.filter(n => !n.pinned);
      filtered = [...pinned, ...unpinned];
    }

    renderNoteList(filtered);
    updateCounts();
  }

  function renderNoteList(notes) {
    const container = document.getElementById('notesContainer');
    container.innerHTML = '';

    if (notes.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:14px;">
        <div style="font-size:40px">📭</div><br>${searchQuery ? 'No results' : 'No notes yet'}
      </div>`;
      return;
    }

    const currentNote = Editor.getCurrentNote();
    notes.forEach(note => {
      const item = document.createElement('div');
      item.className = 'note-item' + (note.id === currentNote?.id ? ' active' : '');
      item.dataset.id = note.id;
      const preview = getPlainText(note.content || '').substring(0, 100);
      const timeAgo = formatTime(note.modifiedAt);
      item.innerHTML = `
        <div class="note-item-title">
          ${note.pinned ? '📌 ' : ''}${note.favorite ? '❤️ ' : ''}
          ${note.title || '<span style="color:var(--text3)">Untitled</span>'}
        </div>
        <div class="note-item-preview">${preview || 'No content'}</div>
        <div class="note-item-meta">
          <span>${timeAgo}</span>
          ${note.tags?.length ? `<span class="note-badge">${note.tags[0].name}</span>` : ''}
          ${note.strokes?.length ? '<span class="note-badge">✏️</span>' : ''}
          ${note.checklist?.length ? `<span class="note-badge">✅ ${note.checklist.filter(i=>i.done).length}/${note.checklist.length}</span>` : ''}
        </div>
      `;
      item.addEventListener('click', () => openNote(note));
      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        showNoteContextMenu(e, note);
      });
      container.appendChild(item);
    });
  }

  function showNoteContextMenu(e, note) {
    document.querySelector('.context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth-200)}px;top:${Math.min(e.clientY, window.innerHeight-200)}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg);z-index:500;overflow:hidden;min-width:180px;`;
    const actions = [
      { label: note.pinned ? '📌 Unpin' : '📌 Pin', action: () => togglePin(note) },
      { label: note.favorite ? '❤️ Unfavorite' : '❤️ Favorite', action: () => toggleFavorite(note) },
      { label: '📋 Duplicate', action: () => duplicateNote(note) },
      { separator: true },
      { label: note.trashed ? '♻️ Restore' : '🗑 Trash', action: () => trashNote(note), danger: !note.trashed },
      ...(note.trashed ? [{ label: '💀 Delete Forever', action: () => deleteForever(note), danger: true }] : [])
    ];
    actions.forEach(a => {
      if (a.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.style.cssText = `display:block;width:100%;padding:10px 16px;background:none;border:none;text-align:left;font-size:14px;cursor:pointer;color:${a.danger ? 'var(--danger)' : 'var(--text)'};`;
      btn.textContent = a.label;
      btn.addEventListener('mouseover', () => btn.style.background = 'var(--surface2)');
      btn.addEventListener('mouseout', () => btn.style.background = 'none');
      btn.addEventListener('click', () => { a.action(); menu.remove(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const closeMenu = e => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  async function togglePin(note) {
    note.pinned = !note.pinned;
    await DB.put(DB.STORES.NOTES, note);
    refreshNoteList();
  }
  async function toggleFavorite(note) {
    note.favorite = !note.favorite;
    await DB.put(DB.STORES.NOTES, note);
    refreshNoteList();
  }
  async function duplicateNote(note) {
    const copy = { ...note, id: Date.now().toString(), title: (note.title || 'Untitled') + ' (copy)', createdAt: Date.now(), modifiedAt: Date.now(), pinned: false };
    await DB.put(DB.STORES.NOTES, copy);
    refreshNoteList();
    openNote(copy);
  }
  async function trashNote(note) {
    note.trashed = !note.trashed;
    await DB.put(DB.STORES.NOTES, note);
    if (note.trashed && Editor.getCurrentNote()?.id === note.id) Editor.closeEditor();
    refreshNoteList();
  }
  async function deleteForever(note) {
    if (!confirm('Delete permanently?')) return;
    await DB.remove(DB.STORES.NOTES, note.id);
    if (Editor.getCurrentNote()?.id === note.id) Editor.closeEditor();
    refreshNoteList();
  }

  function updateNoteItem(note) {
    const item = document.querySelector(`.note-item[data-id="${note.id}"]`);
    if (!item) return;
    const titleEl = item.querySelector('.note-item-title');
    if (titleEl) titleEl.innerHTML = `${note.pinned ? '📌 ' : ''}${note.favorite ? '❤️ ' : ''}${note.title || '<span style="color:var(--text3)">Untitled</span>'}`;
  }

  async function refreshFolders() {
    allFolders = await DB.getAll(DB.STORES.FOLDERS);
    const list = document.getElementById('foldersList');
    list.innerHTML = '';
    for (const folder of allFolders) {
      const count = allNotes.filter(n => n.folderId === folder.id && !n.trashed).length;
      const li = document.createElement('li');
      li.className = 'folder-item' + (folder.id === currentFolderId ? ' active' : '');
      li.innerHTML = `
        <span>${folder.icon}</span>
        <span class="folder-name">${folder.name}</span>
        <span class="folder-count">${count}</span>
        <button class="delete-folder" data-id="${folder.id}">✕</button>
      `;
      li.addEventListener('click', e => {
        if (e.target.classList.contains('delete-folder')) return;
        document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        li.classList.add('active');
        currentFolderId = folder.id;
        currentTagId = null;
        currentFilter = 'folder';
        updateNoteListTitle(folder.name);
        refreshNoteList();
      });
      li.querySelector('.delete-folder').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Delete folder "${folder.name}"?`)) return;
        const folderNotes = allNotes.filter(n => n.folderId === folder.id);
        for (const n of folderNotes) { n.folderId = null; await DB.put(DB.STORES.NOTES, n); }
        await DB.remove(DB.STORES.FOLDERS, folder.id);
        if (currentFolderId === folder.id) {
          currentFolderId = null;
          currentFilter = 'all';
          document.querySelector('[data-filter="all"]').classList.add('active');
        }
        refreshFolders(); refreshNoteList();
      });
      list.appendChild(li);
    }
  }

  async function refreshTags() {
    allTags = await DB.getAll(DB.STORES.TAGS);
    const container = document.getElementById('tagsList');
    container.innerHTML = '';
    allTags.forEach(tag => {
      const pill = document.createElement('div');
      pill.className = 'tag-pill' + (tag.id === currentTagId ? ' active' : '');
      pill.style.background = tag.color;
      pill.innerHTML = `#${tag.name} <button class="remove-tag" data-id="${tag.id}">✕</button>`;
      pill.addEventListener('click', e => {
        if (e.target.classList.contains('remove-tag')) return;
        document.querySelectorAll('.tag-pill').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        pill.classList.add('active');
        currentTagId = tag.id;
        currentFolderId = null;
        currentFilter = 'tag';
        updateNoteListTitle('#' + tag.name);
        refreshNoteList();
      });
      pill.querySelector('.remove-tag').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Delete tag "#${tag.name}"?`)) return;
        await DB.remove(DB.STORES.TAGS, tag.id);
        for (const note of allNotes) {
          if (note.tags?.some(t => t.id === tag.id)) {
            note.tags = note.tags.filter(t => t.id !== tag.id);
            await DB.put(DB.STORES.NOTES, note);
          }
        }
        if (currentTagId === tag.id) {
          currentTagId = null; currentFilter = 'all';
          document.querySelector('[data-filter="all"]').classList.add('active');
        }
        refreshTags(); refreshNoteList();
      });
      container.appendChild(pill);
    });
  }

  async function updateCounts() {
    const notes = await DB.getAll(DB.STORES.NOTES);
    document.getElementById('allCount').textContent = notes.filter(n => !n.trashed).length;
    document.getElementById('pinnedCount').textContent = notes.filter(n => n.pinned && !n.trashed).length;
    document.getElementById('favCount').textContent = notes.filter(n => n.favorite && !n.trashed).length;
    document.getElementById('trashCount').textContent = notes.filter(n => n.trashed).length;
  }

  function updateNoteListTitle(title) {
    const el = document.getElementById('noteListTitle');
    if (el) el.textContent = title || ({ all: 'All Notes', pinned: 'Pinned', favorites: 'Favorites', trash: 'Trash' }[currentFilter] || 'Notes');
  }

  async function refreshAll() { await loadData(); }

  function getPlainText(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.innerText || temp.textContent || '';
  }

  function formatTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return { init, refreshNoteList, refreshFolders, refreshTags, refreshAll, updateNoteItem, updateCounts };
})();

document.addEventListener('DOMContentLoaded', () => NoteApp.init());
