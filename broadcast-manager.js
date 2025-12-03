/**
 * Broadcast Manager - Push live schedule to viewers
 * 
 * Captures rendered table HTML and pushes to Supabase
 * for read-only viewing via shareable link.
 */

(function() {
  'use strict';
  
  const BROADCAST_VIEWER_URL = 'https://marcoajello.github.io/skeduler-broadcast/';
  
  let currentBroadcast = null;
  let autoBroadcast = false;
  
  /**
   * Generate a random 6-character broadcast code
   */
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
  
  /**
   * Capture the schedule table HTML with print columns only
   */
  function captureTableHTML() {
    const table = document.querySelector('.schedule');
    if (!table) {
      console.error('[Broadcast] No schedule table found');
      return null;
    }
    
    // Clone the table to avoid modifying the original
    const clone = table.cloneNode(true);
    
    // Get print column settings
    const cols = window.readState?.()?.cols || [];
    const hiddenCols = cols.filter(c => !c.print).map(c => c.key);
    
    // Also hide control columns
    hiddenCols.push('drag', 'sharpie', 'actions');
    
    // Hide non-print columns
    hiddenCols.forEach(key => {
      // Hide colgroup col
      const col = clone.querySelector(`colgroup col[data-key="${key}"]`);
      if (col) col.style.width = '0';
      
      // Hide th
      const th = clone.querySelector(`thead th[data-key="${key}"]`);
      if (th) th.style.display = 'none';
      
      // Hide tds
      clone.querySelectorAll(`tbody td[data-key="${key}"]`).forEach(td => {
        td.style.display = 'none';
      });
    });
    
    // Remove interactive elements
    clone.querySelectorAll('button, input, .drag-cell, .sharpie, .actions-cell').forEach(el => {
      el.remove();
    });
    
    // Remove any drag handles
    clone.querySelectorAll('[draggable]').forEach(el => {
      el.removeAttribute('draggable');
    });
    
    // Get computed styles for the table
    const styles = captureStyles();
    
    // Build complete HTML document
    const html = `
      <style>${styles}</style>
      <div class="broadcast-schedule">${clone.outerHTML}</div>
    `;
    
    return html;
  }
  
  /**
   * Capture necessary CSS for the table
   */
  function captureStyles() {
    // Core styles needed for the schedule table
    return `
      .broadcast-schedule {
        font-family: 'Avenir', 'Century Gothic', -apple-system, sans-serif;
        font-size: 12px;
        background: #fff;
        color: #000;
      }
      
      .broadcast-schedule table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      
      .broadcast-schedule th,
      .broadcast-schedule td {
        padding: 8px 6px;
        text-align: left;
        vertical-align: middle;
        border: 1px solid #ddd;
      }
      
      .broadcast-schedule thead th {
        background: #f5f5f5;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.5px;
      }
      
      .broadcast-schedule tbody tr:nth-child(even) {
        background: #fafafa;
      }
      
      .broadcast-schedule .row-complete {
        opacity: 0.5;
      }
      
      .broadcast-schedule .row-complete td {
        text-decoration: line-through;
        text-decoration-color: #e53935;
      }
      
      .broadcast-schedule .event-row,
      .broadcast-schedule tr[data-type="EVENT"] {
        background: #e3f2fd !important;
      }
      
      .broadcast-schedule .calltime-row,
      .broadcast-schedule tr[data-type="CALLTIME"] {
        background: #e8f5e9 !important;
        font-weight: 600;
      }
      
      .broadcast-schedule img {
        max-width: 100px;
        max-height: 60px;
        object-fit: contain;
      }
      
      /* Preserve inline styles from cells */
      .broadcast-schedule [style] {
        /* Allow inline styles to override */
      }
    `;
  }
  
  /**
   * Push broadcast to Supabase
   */
  async function pushBroadcast(options = {}) {
    if (!window.SupabaseAPI?.auth?.isAuthenticated?.()) {
      throw new Error('Not authenticated');
    }
    
    const user = window.SupabaseAPI.auth.getCurrentUser();
    if (!user) throw new Error('No user');
    
    // Capture HTML
    const html = captureTableHTML();
    if (!html) throw new Error('Could not capture table');
    
    // Get schedule title
    const state = window.readState?.() || {};
    const title = options.title || state.projectMeta?.title || 'Schedule';
    const fileName = title.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Check for existing broadcast
    const client = window.SupabaseAPI.client();
    let broadcast = currentBroadcast;
    
    if (!broadcast) {
      // Look for existing broadcast for this file
      const { data } = await client
        .from('broadcasts')
        .select('*')
        .eq('user_id', user.id)
        .eq('file_name', fileName)
        .single();
      
      broadcast = data;
    }
    
    // Generate new code if needed
    const code = broadcast?.code || generateCode();
    
    // Save HTML to storage
    const htmlPath = `${user.id}/${fileName}.html`;
    const blob = new Blob([html], { type: 'text/html' });
    
    // Delete existing and upload
    try {
      await client.storage.from('schedule-files').remove([htmlPath]);
    } catch (e) { /* may not exist */ }
    
    const { error: uploadError } = await client.storage
      .from('schedule-files')
      .upload(htmlPath, blob, { cacheControl: '60', upsert: false });
    
    if (uploadError) throw uploadError;
    
    // Create or update broadcast record
    if (broadcast) {
      // Update existing
      const { data, error } = await client
        .from('broadcasts')
        .update({
          title: title,
          auto_update: options.autoUpdate ?? broadcast.auto_update,
          updated_at: new Date().toISOString()
        })
        .eq('id', broadcast.id)
        .select()
        .single();
      
      if (error) throw error;
      currentBroadcast = data;
    } else {
      // Create new
      const { data, error } = await client
        .from('broadcasts')
        .insert({
          code: code,
          user_id: user.id,
          file_name: fileName,
          title: title,
          auto_update: options.autoUpdate ?? false
        })
        .select()
        .single();
      
      if (error) throw error;
      currentBroadcast = data;
    }
    
    console.log('[Broadcast] Pushed successfully:', currentBroadcast.code);
    
    return {
      code: currentBroadcast.code,
      url: BROADCAST_VIEWER_URL + '?c=' + currentBroadcast.code,
      title: title
    };
  }
  
  /**
   * Show broadcast dialog with shareable link
   */
  function showBroadcastDialog(result) {
    // Remove existing dialog
    const existing = document.getElementById('broadcastDialog');
    if (existing) existing.remove();
    
    const dialog = document.createElement('div');
    dialog.id = 'broadcastDialog';
    dialog.innerHTML = `
      <div class="broadcast-overlay">
        <div class="broadcast-modal">
          <div class="broadcast-header">
            <h2>📡 BROADCAST LIVE</h2>
            <button class="broadcast-close">&times;</button>
          </div>
          <div class="broadcast-body">
            <p>Share this link with your crew:</p>
            <div class="broadcast-url-box">
              <input type="text" readonly value="${result.url}" id="broadcastUrl">
              <button class="broadcast-copy" id="broadcastCopyBtn">COPY</button>
            </div>
            <div class="broadcast-code">
              Code: <strong>${result.code}</strong>
            </div>
            <div class="broadcast-options">
              <label>
                <input type="checkbox" id="broadcastAutoUpdate" ${autoBroadcast ? 'checked' : ''}>
                Auto-update on every cloud push
              </label>
            </div>
          </div>
          <div class="broadcast-footer">
            <button class="broadcast-btn secondary" id="broadcastRefreshBtn">↻ Update Now</button>
            <button class="broadcast-btn primary" id="broadcastDoneBtn">Done</button>
          </div>
        </div>
      </div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .broadcast-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
      }
      .broadcast-modal {
        background: var(--panel, #1c1f24);
        border: 1px solid var(--border, #30363d);
        border-radius: 12px;
        width: 90%;
        max-width: 440px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      .broadcast-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border, #30363d);
      }
      .broadcast-header h2 {
        margin: 0;
        font-size: 16px;
        letter-spacing: 1px;
      }
      .broadcast-close {
        background: none;
        border: none;
        font-size: 24px;
        color: var(--muted, #7d8590);
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }
      .broadcast-body {
        padding: 20px;
      }
      .broadcast-body p {
        margin: 0 0 12px;
        color: var(--muted, #7d8590);
      }
      .broadcast-url-box {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }
      .broadcast-url-box input {
        flex: 1;
        padding: 12px;
        font-size: 13px;
        background: var(--row, #0d1117);
        border: 1px solid var(--border, #30363d);
        border-radius: 6px;
        color: var(--text, #e6edf3);
      }
      .broadcast-copy {
        padding: 12px 16px;
        font-size: 12px;
        font-weight: 600;
        background: var(--accent, #58a6ff);
        border: none;
        border-radius: 6px;
        color: #000;
        cursor: pointer;
      }
      .broadcast-code {
        text-align: center;
        padding: 12px;
        background: var(--row, #0d1117);
        border-radius: 6px;
        font-size: 14px;
        margin-bottom: 16px;
      }
      .broadcast-code strong {
        font-size: 20px;
        letter-spacing: 3px;
        color: var(--accent, #58a6ff);
      }
      .broadcast-options {
        font-size: 13px;
        color: var(--muted, #7d8590);
      }
      .broadcast-options label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      .broadcast-footer {
        display: flex;
        gap: 12px;
        padding: 16px 20px;
        border-top: 1px solid var(--border, #30363d);
      }
      .broadcast-btn {
        flex: 1;
        padding: 12px;
        font-size: 13px;
        font-weight: 600;
        border-radius: 6px;
        cursor: pointer;
      }
      .broadcast-btn.secondary {
        background: transparent;
        border: 1px solid var(--border, #30363d);
        color: var(--text, #e6edf3);
      }
      .broadcast-btn.primary {
        background: var(--accent, #58a6ff);
        border: none;
        color: #000;
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(dialog);
    
    // Event handlers
    dialog.querySelector('.broadcast-close').onclick = () => dialog.remove();
    dialog.querySelector('#broadcastDoneBtn').onclick = () => dialog.remove();
    dialog.querySelector('.broadcast-overlay').onclick = (e) => {
      if (e.target === e.currentTarget) dialog.remove();
    };
    
    dialog.querySelector('#broadcastCopyBtn').onclick = () => {
      const input = document.getElementById('broadcastUrl');
      input.select();
      document.execCommand('copy');
      const btn = dialog.querySelector('#broadcastCopyBtn');
      btn.textContent = 'COPIED!';
      setTimeout(() => btn.textContent = 'COPY', 2000);
    };
    
    dialog.querySelector('#broadcastAutoUpdate').onchange = (e) => {
      autoBroadcast = e.target.checked;
      localStorage.setItem('broadcastAutoUpdate', autoBroadcast);
    };
    
    dialog.querySelector('#broadcastRefreshBtn').onclick = async () => {
      const btn = dialog.querySelector('#broadcastRefreshBtn');
      btn.textContent = 'Updating...';
      btn.disabled = true;
      try {
        await pushBroadcast({ autoUpdate: autoBroadcast });
        btn.textContent = '✓ Updated';
        setTimeout(() => {
          btn.textContent = '↻ Update Now';
          btn.disabled = false;
        }, 2000);
      } catch (e) {
        btn.textContent = 'Failed';
        setTimeout(() => {
          btn.textContent = '↻ Update Now';
          btn.disabled = false;
        }, 2000);
      }
    };
  }
  
  /**
   * Initialize broadcast manager
   */
  function init() {
    // Load auto-broadcast setting
    autoBroadcast = localStorage.getItem('broadcastAutoUpdate') === 'true';
    
    console.log('[Broadcast] Manager initialized, auto-update:', autoBroadcast);
  }
  
  /**
   * Hook into cloud push to auto-broadcast if enabled
   */
  function hookAutoBroadcast() {
    // This will be called after a successful cloud push
    if (autoBroadcast) {
      console.log('[Broadcast] Auto-broadcasting...');
      pushBroadcast({ autoUpdate: true }).catch(err => {
        console.error('[Broadcast] Auto-broadcast failed:', err);
      });
    }
  }
  
  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Export
  window.BroadcastManager = {
    push: pushBroadcast,
    showDialog: showBroadcastDialog,
    hookAutoBroadcast: hookAutoBroadcast,
    isAutoEnabled: () => autoBroadcast,
    setAutoEnabled: (val) => {
      autoBroadcast = val;
      localStorage.setItem('broadcastAutoUpdate', val);
    }
  };
  
})();
