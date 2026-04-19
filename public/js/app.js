// Sidebar toggle (mobile)
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('show');
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) overlay.style.display = 'none';
}
document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) {
    sidebar.classList.toggle('show');
    if (overlay) overlay.style.display = sidebar.classList.contains('show') ? 'block' : 'none';
  }
});

// Method override for PUT/DELETE forms
document.addEventListener('submit', function (e) {
  const form = e.target;
  const method = form.querySelector('input[name="_method"]');
  if (method) {
    form.method = 'POST';
    const url = new URL(form.action, window.location.href);
    url.searchParams.set('_method', method.value);
    form.action = url.toString();
  }
});

// Auto-calculate voucher amounts
function calcVoucherAmounts() {
  const amount = parseFloat(document.getElementById('amount')?.value) || 0;
  const gwPct = parseFloat(document.getElementById('gw_fund_percent')?.value) || 5;
  const repPct = parseFloat(document.getElementById('representative_percent')?.value) || 5;

  const gwAmt = (amount * gwPct / 100).toFixed(2);
  const repAmt = (amount * repPct / 100).toFixed(2);
  const finalAmt = (amount - parseFloat(gwAmt) - parseFloat(repAmt)).toFixed(2);

  const gwAmtEl = document.getElementById('gw_fund_amount');
  const repAmtEl = document.getElementById('representative_amount');
  const finalEl = document.getElementById('final_amount');

  if (gwAmtEl) gwAmtEl.value = gwAmt;
  if (repAmtEl) repAmtEl.value = repAmt;
  if (finalEl) finalEl.value = finalAmt;
}

['amount', 'gw_fund_percent', 'representative_percent'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', calcVoucherAmounts);
});

// DataTable init helper with comprehensive configuration
function initDataTable(selector, opts = {}) {
  if (!$.fn.DataTable) return;

  const defaults = {
    // Layout and DOM structure — B=buttons, l=length, f=search, t=table, i=info, p=pagination
    dom: "<'row mb-2'<'col-sm-12 col-md-5'B><'col-sm-6 col-md-3'l><'col-sm-6 col-md-4'f>>" +
         "<'row'<'col-sm-12'tr>>" +
         "<'row mt-2 align-items-center'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7 d-flex justify-content-end'p>>",

    // Export buttons
    buttons: [
      {
        extend: 'copy',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-files me-1"></i>Copy'
      },
      {
        extend: 'csv',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-file-earmark-csv me-1"></i>CSV'
      },
      {
        extend: 'excel',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-file-earmark-excel me-1"></i>Excel'
      },
      {
        extend: 'pdf',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-file-earmark-pdf me-1"></i>PDF'
      },
      {
        extend: 'print',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-printer me-1"></i>Print'
      },
      {
        extend: 'colvis',
        className: 'btn btn-sm btn-outline-secondary',
        text: '<i class="bi bi-eye me-1"></i>Columns'
      }
    ],

    // Pagination and display
    pageLength: 25,
    lengthMenu: [[25, 50, 100, -1], ['25', '50', '100', 'All']],
    pagingType: 'simple_numbers',

    // Responsiveness
    responsive: true,
    autoWidth: false,

    // Search
    language: {
      search: '_INPUT_',
      searchPlaceholder: 'Search...',
      lengthMenu: '_MENU_ per page',
      info: 'Showing _START_–_END_ of _TOTAL_',
      infoEmpty: 'No records found',
      infoFiltered: '(filtered from _MAX_)',
      paginate: {
        first: '«',
        last: '»',
        next: '›',
        previous: '‹'
      }
    },

    // Sorting
    order: [],
    orderCellsTop: true,

    // Styling
    stripeClasses: ['table-light'],
    columnDefs: [
      { targets: '_all', className: 'dt-center align-middle' }
    ]
  };

  const table = $(selector).DataTable({ ...defaults, ...opts });

  // Add row styling
  table.on('draw', function() {
    table.rows().nodes().forEach((row, index) => {
      if (index % 2 === 0) {
        $(row).addClass('table-light');
      }
    });
  });

  return table;
}

// Delete confirm
document.querySelectorAll('[data-confirm]').forEach(el => {
  el.addEventListener('click', e => {
    if (!confirm(el.dataset.confirm || 'Are you sure?')) e.preventDefault();
  });
});

// Auto-dismiss alerts
setTimeout(() => {
  document.querySelectorAll('.alert').forEach(el => {
    const bsAlert = bootstrap.Alert.getOrCreateInstance(el);
    bsAlert?.close();
  });
}, 5000);

// Initialize Select2 for all searchable dropdowns
$(function() {
  if (typeof $.fn.select2 !== 'undefined') {
    $('.select2-search').select2({
      theme: 'bootstrap-5',
      width: '100%',
      allowClear: true,
      placeholder: '— Select —'
    });
  }
});
