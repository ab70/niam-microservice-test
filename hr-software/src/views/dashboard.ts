export const dashboardPage = (user: { email: string; firstName: string }, staff: any[]) => /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HR Software — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      background: #f1f5f9; color: #1e293b;
    }

    /* ── Topbar ─────────────────────────────────────────── */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px;
      background: #ffffff; border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
    }
    .topbar h1 { font-size: 1.15rem; font-weight: 700; color: #0f172a; }
    .topbar .right { display: flex; align-items: center; gap: 16px; }
    .topbar .right span { color: #64748b; font-size: .85rem; }
    .topbar .right a {
      color: #ef4444; text-decoration: none; font-size: .85rem; font-weight: 600;
    }
    .topbar .right a:hover { text-decoration: underline; }

    /* ── Main layout ────────────────────────────────────── */
    .main { max-width: 1200px; margin: 32px auto; padding: 0 32px; }

    /* ── Stats row ──────────────────────────────────────── */
    .stats { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .stat-card {
      flex: 1; min-width: 180px; padding: 20px 24px;
      background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
    }
    .stat-card .label { font-size: .75rem; text-transform: uppercase; color: #64748b; letter-spacing: .5px; font-weight: 600; }
    .stat-card .value { font-size: 2rem; font-weight: 700; margin-top: 4px; color: #0f172a; }

    /* ── Tabs ───────────────────────────────────────────── */
    .tabs { display: flex; gap: 4px; margin-bottom: 24px; }
    .tab {
      padding: 10px 20px; border-radius: 8px; cursor: pointer;
      font-size: .85rem; font-weight: 600; background: #ffffff; border: 1px solid #e2e8f0;
      color: #64748b; transition: all .2s;
    }
    .tab:hover { background: #f8fafc; color: #334155; border-color: #cbd5e1; }
    .tab.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }

    .panel { display: none; }
    .panel.active { display: block; }

    /* ── Card containers ────────────────────────────────── */
    .card {
      background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 24px; margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
    }
    .card h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; color: #0f172a; }

    /* ── Table ──────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left; padding: 10px 12px; font-size: .75rem;
      text-transform: uppercase; color: #64748b; letter-spacing: .5px; font-weight: 600;
      border-bottom: 2px solid #e2e8f0;
    }
    td {
      padding: 12px; font-size: .85rem; border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tr:hover td { background: #f8fafc; }

    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: .7rem; font-weight: 600;
    }
    .badge.active { background: #dcfce7; color: #166534; }
    .badge.inactive { background: #fef2f2; color: #b91c1c; }

    .empty { text-align: center; padding: 40px; color: #94a3b8; }

    /* ── Forms ──────────────────────────────────────────── */
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-grid .full { grid-column: 1 / -1; }

    .field { margin-bottom: 16px; }
    .field label {
      display: block; font-size: .8rem; font-weight: 600;
      color: #475569; margin-bottom: 6px;
    }
    .field input, .field select {
      width: 100%; padding: 10px 12px; font-size: .9rem;
      background: #f8fafc; color: #0f172a;
      border: 1px solid #e2e8f0; border-radius: 8px; outline: none;
      transition: border-color .2s, box-shadow .2s;
    }
    .field input:focus, .field select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; font-size: .85rem; font-weight: 600;
      border: none; border-radius: 8px; cursor: pointer; transition: all .2s;
    }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-success { background: #10b981; color: #fff; }
    .btn-success:hover { background: #059669; }
    .btn-outline { background: transparent; border: 1px solid #cbd5e1; color: #475569; }
    .btn-outline:hover { border-color: #94a3b8; color: #334155; }
    .btn-secondary { background: #8b5cf6; color: #fff; }
    .btn-secondary:hover { background: #7c3aed; }

    /* ── Upload zone ────────────────────────────────────── */
    .upload-zone {
      border: 2px dashed #cbd5e1; border-radius: 12px;
      padding: 40px; text-align: center; cursor: pointer;
      transition: all .2s;
    }
    .upload-zone:hover { border-color: #3b82f6; background: rgba(59, 130, 246, .03); }
    .upload-zone .icon { font-size: 2rem; margin-bottom: 8px; }
    .upload-zone p { color: #64748b; font-size: .85rem; }
    .upload-zone input[type="file"] { display: none; }

    .flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: .85rem; }
    .flash.success { background: #dcfce7; border: 1px solid #bbf7d0; color: #166534; }
    .flash.error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }

    /* ── Row actions ──────────────────────────────────── */
    .row-actions { display: flex; gap: 8px; }
    .btn-xs {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; font-size: .75rem; font-weight: 600;
      border: none; border-radius: 6px; cursor: pointer; transition: all .2s;
    }
    .btn-edit { background: #e0e7ff; color: #3730a3; }
    .btn-edit:hover { background: #c7d2fe; }
    .btn-delete { background: #fee2e2; color: #b91c1c; }
    .btn-delete:hover { background: #fecaca; }

    /* ── Modal ─────────────────────────────────────────── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(15,23,42,.5);
      display: none; align-items: flex-start; justify-content: center;
      padding: 40px 16px; overflow-y: auto; z-index: 50;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #fff; border-radius: 14px; width: 100%; max-width: 720px;
      padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,.2);
    }
    .modal h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: 20px; color: #0f172a; }
    .modal .modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .modal .close {
      background: transparent; border: none; font-size: 1.4rem; cursor: pointer; color: #94a3b8;
    }
    .modal .close:hover { color: #334155; }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>🏢 HR Software</h1>
    <div class="right">
      <span>👤 ${user.firstName || user.email}</span>
      <a href="/logout">Logout</a>
    </div>
  </div>

  <div class="main">
    <!-- Stats -->
    <div class="stats">
      <div class="stat-card">
        <div class="label">Total Staff</div>
        <div class="value">${staff.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Active</div>
        <div class="value">${staff.filter(s => s.active).length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Inactive</div>
        <div class="value">${staff.filter(s => !s.active).length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Sync API</div>
        <div class="value" style="font-size:1rem"><a href="/api/staff" target="_blank" style="color:#3b82f6">/api/staff</a></div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab active" onclick="switchTab('list', this)">📋 Staff List</div>
      <div class="tab" onclick="switchTab('add', this)">➕ Add Staff</div>
      <div class="tab" onclick="switchTab('upload', this)">📤 Excel Upload</div>
    </div>

    <!-- Flash messages -->
    <div id="flash"></div>

    <!-- Panel: Staff List -->
    <div class="panel active" id="panel-list">
      <div class="card">
        <h2>All Staff (${staff.length})</h2>
                 ${staff.length === 0
          ? `<div class="empty">No staff members yet. Add some or upload an Excel file.</div>`
          : `<table>
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Department</th>
                  <th>Designation</th><th>Employee ID</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${staff.map(s => `
                  <tr>
                    <td>${s.firstName} ${s.lastName}</td>
                    <td>${s.email}</td>
                    <td>${s.department || '—'}</td>
                    <td>${s.designation || '—'}</td>
                    <td>${s.employee_Id || '—'}</td>
                    <td><span class="badge ${s.active ? 'active' : 'inactive'}">${s.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div class="row-actions">
                        <button class="btn-xs btn-edit" onclick='openEdit(${s.id})'>✏️ Edit</button>
                        <form method="POST" action="/staff/delete/${s.id}" onsubmit="return confirm('Delete ${s.firstName} ${s.lastName}?')">
                          <button type="submit" class="btn-xs btn-delete">🗑️ Delete</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>`
        }
      </div>
    </div>

    <!-- Panel: Add Staff -->
    <div class="panel" id="panel-add">
      <div class="card">
        <h2>Add New Staff Member</h2>
        <form method="POST" action="/staff/add">
          <div class="form-grid">
            <div class="field">
              <label>First Name *</label>
              <input type="text" name="firstName" required />
            </div>
            <div class="field">
              <label>Last Name *</label>
              <input type="text" name="lastName" required />
            </div>
            <div class="field">
              <label>Nick Name</label>
              <input type="text" name="nick_Name" />
            </div>
            <div class="field">
              <label>Email *</label>
              <input type="email" name="email" required />
            </div>
            <div class="field">
              <label>Phone</label>
              <input type="text" name="phone" />
            </div>
            <div class="field">
              <label>Employee ID</label>
              <input type="text" name="employee_Id" />
            </div>
            <div class="field">
              <label>UID</label>
              <input type="text" name="uid" />
            </div>
            <div class="field">
              <label>Department</label>
              <input type="text" name="department" />
            </div>
            <div class="field">
              <label>Designation</label>
              <input type="text" name="designation" />
            </div>
            <div class="field">
              <label>Office</label>
              <input type="text" name="office" />
            </div>
            <div class="field">
              <label>Joining Date</label>
              <input type="date" name="joining_Date" />
            </div>
            <div class="field">
              <label>Effective Date</label>
              <input type="date" name="effective_Date" />
            </div>

            <div class="field">
              <label>Division</label>
              <input type="text" name="division" />
            </div>
            <div class="field">
              <label>Section</label>
              <input type="text" name="section" />
            </div>
            <div class="field">
              <label>Sub Section</label>
              <input type="text" name="sub_Section" />
            </div>

            <div class="field">
              <label>Band</label>
              <input type="text" name="band" />
            </div>
            <div class="field">
              <label>Position</label>
              <input type="text" name="position" />
            </div>
            <div class="field">
              <label>Unit</label>
              <input type="text" name="unit" />
            </div>
            <div class="field">
              <label>Supervisor Email</label>
              <input type="email" name="supervisor" />
            </div>
            <div class="field">
              <label>Supervisor Name</label>
              <input type="text" name="supervisorName" />
            </div>

            <div class="field full">
              <label>Address</label>
              <input type="text" name="address" />
            </div>
          </div>
          <div style="margin-top: 16px; display: flex; gap: 12px;">
            <button type="button" class="btn btn-secondary" onclick="generateStaff()">⚡ Generate</button>
            <button type="submit" class="btn btn-primary">➕ Add Staff</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Panel: Excel Upload -->
    <div class="panel" id="panel-upload">
      <div class="card">
        <h2>Bulk Import Staff from Excel</h2>
        <p style="color:#64748b; font-size:.85rem; margin-bottom:20px">
          Upload a <strong>.xlsx</strong> or <strong>.csv</strong> file. Column headers should match staff fields:
          <code style="color:#2563eb">email</code>, <code style="color:#2563eb">firstName</code>,
          <code style="color:#2563eb">lastName</code>, <code style="color:#2563eb">department</code>,
          <code style="color:#2563eb">designation</code>, <code style="color:#2563eb">employee_Id</code>, etc.
        </p>
        <form method="POST" action="/staff/upload" enctype="multipart/form-data">
          <div class="upload-zone" onclick="this.querySelector('input').click()">
            <div class="icon">📁</div>
            <p>Click to select file or drag & drop</p>
            <p style="margin-top:8px; font-size:.75rem; color:#94a3b8">.xlsx or .csv, max 10MB</p>
            <input type="file" name="file" accept=".xlsx,.csv" required
                   onchange="document.getElementById('file-label').textContent = this.files[0]?.name || 'No file selected'" />
          </div>
          <p id="file-label" style="margin-top:12px; font-size:.85rem; color:#64748b; text-align:center"></p>
          <div style="margin-top: 20px; text-align: center">
            <button type="submit" class="btn btn-success">📤 Upload & Import</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- Edit Staff Modal -->
  <div class="modal-overlay" id="edit-modal" onclick="if(event.target===this) closeEdit()">
    <div class="modal">
      <div class="modal-head">
        <h2>Edit Staff Member</h2>
        <button class="close" type="button" onclick="closeEdit()">&times;</button>
      </div>
      <form method="POST" id="edit-form" action="/staff/edit/0">
        <input type="hidden" name="id" id="edit-id" />
        <div class="form-grid">
          <div class="field">
            <label>First Name *</label>
            <input type="text" name="firstName" id="edit-firstName" required />
          </div>
          <div class="field">
            <label>Last Name *</label>
            <input type="text" name="lastName" id="edit-lastName" required />
          </div>
          <div class="field">
            <label>Email *</label>
            <input type="email" name="email" id="edit-email" required />
          </div>
          <div class="field">
            <label>Phone</label>
            <input type="text" name="phone" id="edit-phone" />
          </div>
          <div class="field">
            <label>Employee ID</label>
            <input type="text" name="employee_Id" id="edit-employee_Id" />
          </div>
          <div class="field">
            <label>Department</label>
            <input type="text" name="department" id="edit-department" />
          </div>
          <div class="field">
            <label>Designation</label>
            <input type="text" name="designation" id="edit-designation" />
          </div>
          <div class="field">
            <label>Office</label>
            <input type="text" name="office" id="edit-office" />
          </div>
          <div class="field">
            <label>Division</label>
            <input type="text" name="division" id="edit-division" />
          </div>
          <div class="field">
            <label>Section</label>
            <input type="text" name="section" id="edit-section" />
          </div>
          <div class="field">
            <label>Band</label>
            <input type="text" name="band" id="edit-band" />
          </div>
          <div class="field">
            <label>Position</label>
            <input type="text" name="position" id="edit-position" />
          </div>
          <div class="field">
            <label>Unit</label>
            <input type="text" name="unit" id="edit-unit" />
          </div>
          <div class="field">
            <label>Supervisor Email</label>
            <input type="email" name="supervisor" id="edit-supervisor" />
          </div>
          <div class="field">
            <label>Status</label>
            <select name="active" id="edit-active">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>
          <div class="field full">
            <label>Address</label>
            <input type="text" name="address" id="edit-address" />
          </div>
        </div>
        <div style="margin-top: 16px; display:flex; gap:12px; justify-content:flex-end">
          <button type="button" class="btn btn-outline" onclick="closeEdit()">Cancel</button>
          <button type="submit" class="btn btn-primary">💾 Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const STAFF = ${JSON.stringify(staff)};

    function switchTab(name, el) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

      el.classList.add('active');
      document.getElementById('panel-' + name).classList.add('active');
    }

    function openEdit(id) {
      const s = STAFF.find(x => x.id === id);
      if (!s) return;
      const form = document.getElementById('edit-form');
      form.action = '/staff/edit/' + s.id;
      const fields = ['id','firstName','lastName','nick_Name','email','phone','address','employee_Id','uid','office','joining_Date','effective_Date','division','designation','band','position','department','section','sub_Section','unit','supervisor','supervisorName','active'];
      fields.forEach(f => {
        const el = document.getElementById('edit-' + f);
        if (!el) return;
        let val = s[f];
        if (f === 'active') val = s.active ? '1' : '0';
        el.value = val === null || val === undefined ? '' : val;
      });
      document.getElementById('edit-modal').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeEdit() {
      document.getElementById('edit-modal').classList.remove('open');
      document.body.style.overflow = '';
    }

    function generateStaff() {
      const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'James', 'Olivia', 'Robert', 'Sophia', 'William', 'Isabella', 'Alex', 'Mia', 'Daniel', 'Charlotte'];
      const lastNames = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Davis', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Hill', 'Green'];

      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const email = firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@niamtest.com';

      // Set form fields
      const form = document.querySelector('#panel-add form');
      if (!form) return;

      const set = (field, value) => {
        const el = form.querySelector('[name="' + field + '"]');
        if (el) el.value = value;
      };

      set('firstName', firstName);
      set('lastName', lastName);
      set('email', email);
      set('department', 'IT');
      set('designation', '');
      set('phone', '');
      set('employee_Id', '');
      set('office', '');
      set('division', '');
      set('section', '');
      set('band', '');
      set('position', '');
      set('unit', '');
      set('supervisor', 'abrar@niamtest.com');
      set('address', '');
      set('nick_Name', '');
      set('uid', '');
      set('joining_Date', '');
      set('effective_Date', '');
      set('sub_Section', '');
      set('supervisorName', '');
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEdit(); });

    // Auto-dismiss flash messages
    setTimeout(() => {
      const f = document.getElementById('flash');
      if (f) f.style.display = 'none';
    }, 5000);
  </script>
</body>
</html>`;
