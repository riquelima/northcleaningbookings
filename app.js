// STATE MANAGEMENT
let bookings = [];
let filteredBookings = [];
let currentTab = 'dashboard';
let selectedDailyDate = '';
let calendarYear = 2026;
let calendarMonth = 6; // Julho (0-indexed = 6)
let currentPage = 1;
const pageSize = 10;

// Chart references
let chartStatusPreview = null;
let chartMonthlyRevenue = null;
let chartPaymentMethods = null;
let chartStatusDistribution = null;

// DOM ELEMENTS
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// INITIALIZATION
const STORAGE_KEY = 'north_bookings_v6';
const STORAGE_VERSION_KEY = 'north_bookings_version';
const CURRENT_DB_VERSION = 'v6_exact_payment_methods';

function initApp() {
    const initialArr = (window.INITIAL_BOOKINGS && Array.isArray(window.INITIAL_BOOKINGS)) ? window.INITIAL_BOOKINGS : [];
    
    // Invalidate old cache version if needed or if stored items count is smaller than initial payload
    const savedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
    const localData = localStorage.getItem(STORAGE_KEY);
    
    let loadedFromLocal = false;
    if (savedVersion === CURRENT_DB_VERSION && localData) {
        try {
            const parsed = JSON.parse(localData);
            if (Array.isArray(parsed) && parsed.length >= initialArr.length && parsed.length > 0) {
                bookings = parsed;
                loadedFromLocal = true;
            }
        } catch (e) {
            console.error("Erro ao carregar do localStorage, restaurando padrão.", e);
        }
    }
    
    if (!loadedFromLocal) {
        localStorage.removeItem('north_bookings');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_DB_VERSION);
        bookings = [...initialArr];
    }

    // Deduplicate and sort initial bookings
    bookings = deduplicateBookings(bookings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));

    sortBookingsGlobal();

    // Set theme from localStorage or system preference
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = savedTheme === 'light' ? 'light-theme' : '';
    updateThemeUI(savedTheme);

    // Initialize Lucide Icons
    lucide.createIcons();

    // Set selected daily date to today's date (Atlanta, US timezone) by default
    selectedDailyDate = getAtlantaDateString();

    // Set calendar navigation to match current month by default
    const today = new Date();
    calendarYear = today.getFullYear();
    calendarMonth = today.getMonth();

    document.getElementById('daily-date-picker').value = selectedDailyDate;
    document.getElementById('dashboard-date-picker').value = selectedDailyDate;

    // Set default theme config UI
    const blurVal = localStorage.getItem('glass_blur') || '16';
    const blurRange = document.getElementById('blur-range');
    if (blurRange) blurRange.value = blurVal;
    changeBlur(blurVal);

    // Setup drag and drop for Excel import
    setupDragAndDrop();

    // Determine initial tab from URL or default to dashboard
    const urlParams = new URLSearchParams(window.location.search);
    const initialTab = urlParams.get('tab') || 'dashboard';
    
    // Switch to initial tab
    switchTab(initialTab);
    
    // Initialize components
    refreshAllData();

    // Trigger real-time background sync 1s after load
    setTimeout(() => {
        syncDataOnlineSilently();
    }, 1000);

    // Periodic real-time sync every 10 seconds
    setInterval(() => {
        syncDataOnlineSilently();
    }, 10000);
}

// REFRESH ALL DATA VIEWS
function refreshAllData() {
    computeKPIs();
    loadDashboardTab();
    loadDailyView();
    renderCalendar();
    filterBookings();
    loadAnalyticsTab();
}

// 1. KPI COMPUTATIONS (GLOBAL)
function computeKPIs() {
    let totalRevenue = 0;
    let totalTips = 0;
    const totalBookings = bookings.length;
    
    bookings.forEach(b => {
        totalRevenue += b.amount || 0;
        totalTips += b.tip || 0;
    });
    
    const avgTicket = totalBookings > 0 ? (totalRevenue / totalBookings) : 0;
    
    // Update DOM
    document.getElementById('kpi-revenue').innerText = formatCurrency(totalRevenue);
    document.getElementById('kpi-bookings').innerText = totalBookings;
    document.getElementById('kpi-tips').innerText = formatCurrency(totalTips);
    document.getElementById('kpi-avg').innerText = formatCurrency(avgTicket);
}

// 2. SPA ROUTING & NAVIGATION
const tabIndices = {
    'dashboard': 0,
    'daily': 1,
    'calendar': 2,
    'bookings': 3,
    'analytics': 4
};

function switchTab(tabId) {
    if (!(tabId in tabIndices)) return;
    
    currentTab = tabId;
    const tabIndex = tabIndices[tabId];
    
    // Apply transform translation to slider container
    const slider = document.getElementById('view-slider');
    slider.style.transform = `translate3d(-${tabIndex * 100}vw, 0, 0)`;
    
    // Update active class on nav items
    document.querySelectorAll('.bottom-nav-bar .nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeNavItem = document.getElementById(`nav-${tabId}`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
    
    // Update URL query parameters without page reload
    window.history.pushState(null, '', `dashboard.html?tab=${tabId}`);
    
    // Special tab updates
    if (tabId === 'calendar') {
        renderCalendar();
    } else if (tabId === 'analytics') {
        loadAnalyticsTab();
    } else if (tabId === 'dashboard') {
        loadDashboardTab();
    }
}

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab') || 'dashboard';
    switchTab(activeTab);
});

// 3. TAB 1: VISÃO GERAL (DASHBOARD)
function loadDashboardTab() {
    const dateInput = document.getElementById('dashboard-date-picker');
    if (!dateInput) return;
    
    const selectedDate = dateInput.value;
    
    // Filter bookings for this day
    const dayBookings = bookings.filter(b => b.date === selectedDate);
    dayBookings.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    
    // Compute day KPIs
    let dayRevenue = 0;
    let dayTips = 0;
    const dayCount = dayBookings.length;
    
    dayBookings.forEach(b => {
        dayRevenue += b.amount || 0;
        dayTips += b.tip || 0;
    });
    
    const dayAvg = dayCount > 0 ? (dayRevenue / dayCount) : 0;
    
    // Update Dashboard KPI elements
    document.getElementById('kpi-revenue').innerText = formatCurrency(dayRevenue);
    document.getElementById('kpi-bookings').innerText = dayCount;
    document.getElementById('kpi-tips').innerText = formatCurrency(dayTips);
    document.getElementById('kpi-avg').innerText = formatCurrency(dayAvg);
    
    // List bookings for this day (up to 5)
    const listContainer = document.getElementById('recent-bookings-list');
    listContainer.innerHTML = '';
    
    const recent = dayBookings.slice(0, 5);
    
    if (recent.length === 0) {
        listContainer.innerHTML = '<p class="view-subtitle" style="text-align: center; padding: 24px;">Nenhum agendamento para este dia.</p>';
    } else {
        recent.forEach(b => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            const statusClass = `badge-${b.status.toLowerCase()}`;
            
            item.innerHTML = `
                <div>
                    <span class="activity-client">${b.name}</span>
                    <div class="activity-meta">
                        <span>${b.time}</span>
                        <span style="margin-left: 8px;">• ${b.payment_method}</span>
                    </div>
                </div>
                <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <span style="font-weight: 700; font-family: var(--font-heading);">${formatCurrency(b.total)}</span>
                    <span class="badge ${statusClass}">${b.status}</span>
                </div>
            `;
            listContainer.appendChild(item);
        });
    }

    // Render status preview chart for this day
    setTimeout(() => {
        renderStatusPreviewChartForDay(dayBookings);
    }, 100);
}

function renderStatusPreviewChartForDay(dayBookings) {
    const ctx = document.getElementById('chart-status-preview');
    if (!ctx) return;

    if (dayBookings.length === 0) {
        if (chartStatusPreview) {
            chartStatusPreview.destroy();
            chartStatusPreview = null;
        }
        return;
    }

    // Compute distribution
    const statusCounts = {};
    dayBookings.forEach(b => {
        statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
    });

    const labels = Object.keys(statusCounts);
    const data = Object.values(statusCounts);

    const colors = labels.map(label => {
        switch(label.toLowerCase()) {
            case 'paid': return '#10b981';
            case 'charged': return '#6366f1';
            case 'unassigned': return '#f59e0b';
            case 'upcoming': return '#3b82f6';
            case 'completed': return '#0ea5e9';
            default: return '#8b5cf6';
        }
    });

    if (chartStatusPreview) {
        chartStatusPreview.destroy();
    }

    const isDark = !document.body.classList.contains('light-theme');

    chartStatusPreview = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#121e18' : '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: isDark ? '#9ca3af' : '#4b5563',
                        font: { family: 'Plus Jakarta Sans', size: 10 }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// 4. TAB 2: VISÃO DIÁRIA (DAILY VIEW)
function loadDailyView() {
    const inputDate = document.getElementById('daily-date-picker').value;
    if (!inputDate) return;
    
    selectedDailyDate = inputDate;
    
    // Filter bookings for this day
    const dayBookings = bookings.filter(b => b.date === selectedDailyDate);
    dayBookings.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
    
    // Compute day KPIs
    let dayRevenue = 0;
    let unpaidCount = 0;
    
    dayBookings.forEach(b => {
        dayRevenue += b.amount || 0;
        if (b.status.toLowerCase() !== 'paid') {
            unpaidCount++;
        }
    });
    
    document.getElementById('daily-revenue').innerText = formatCurrency(dayRevenue);
    document.getElementById('daily-count').innerText = dayBookings.length;
    document.getElementById('daily-unpaid-count').innerText = unpaidCount;
    
    // Populating Table
    const tbody = document.getElementById('daily-table-body');
    tbody.innerHTML = '';
    
    if (dayBookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px;" class="view-subtitle">Nenhum agendamento para este dia.</td></tr>`;
        return;
    }
    
    dayBookings.forEach((b, index) => {
        const tr = document.createElement('tr');
        
        // Find index of this booking in global array for callbacks
        const globalIdx = bookings.findIndex(x => x.name === b.name && x.date === b.date && x.time === b.time);
        
        const statusClass = `badge-${b.status.toLowerCase()}`;
        
        const isPaidOrCharged = b.status === 'Paid' || b.status === 'Charged';
        let paymentDateVal = '-';
        if (isPaidOrCharged) {
            if (b.payment_date && b.payment_date.includes('-')) {
                const year = parseInt(b.payment_date.split('-')[0]);
                if (year > 2000) {
                    paymentDateVal = formatDateString(b.payment_date);
                } else {
                    paymentDateVal = formatDateString(b.date);
                }
            } else {
                paymentDateVal = formatDateString(b.date);
            }
        }
        
        tr.innerHTML = `
            <td style="font-weight: 600;">${b.time}</td>
            <td>
                <div style="font-weight: 700; color: var(--text-primary);">${b.name}</div>
            </td>
            <td style="font-family: var(--font-heading); font-weight: 600;">${formatCurrency(b.amount)}</td>
            <td style="font-family: var(--font-heading); color: #10b981;">${b.tip > 0 ? formatCurrency(b.tip) : '-'}</td>
            <td>${b.payment_method}</td>
            <td>
                <span class="badge ${statusClass}" style="cursor: pointer;" onclick="toggleStatusPrompt(${globalIdx})" title="Clique para alterar status">${b.status}</span>
            </td>
            <td>${paymentDateVal}</td>
            <td>
                <button class="theme-toggle-btn" style="padding: 6px 12px; font-size: 0.75rem;" onclick="openDetailModal(${globalIdx})">
                    <i data-lucide="eye" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Ver
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    lucide.createIcons();
}

// Interactive status change prompt
function toggleStatusPrompt(idx) {
    if (idx < 0 || idx >= bookings.length) return;
    const b = bookings[idx];
    const statusOptions = ["Paid", "Charged", "Unassigned", "Upcoming", "Completed"];
    
    const currentIdx = statusOptions.indexOf(b.status);
    const nextIdx = (currentIdx + 1) % statusOptions.length;
    
    const oldStatus = b.status;
    b.status = statusOptions[nextIdx];
    
    // Save
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    
    // Notification or alert (optional, we just refresh UI)
    refreshAllData();
}

// 5. TAB 3: CALENDÁRIO (CALENDAR VIEW)
const monthsPt = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function changeMonth(direction) {
    calendarMonth += direction;
    if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    } else if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    }
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    // Set title
    document.getElementById('calendar-title').innerText = `${monthsPt[calendarMonth]} ${calendarYear}`;
    
    // Day headers
    const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    weekdays.forEach(day => {
        const el = document.createElement('div');
        el.className = 'calendar-day-header';
        el.innerText = day;
        grid.appendChild(el);
    });
    
    // Calendar math
    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay(); // Day of week index (0 = Sun)
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    
    // Pad previous month days
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell inactive';
        cell.innerHTML = `<span class="day-number">${prevMonthDays - i}</span>`;
        grid.appendChild(cell);
    }
    
    // Current month days
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const dayBookings = bookings.filter(b => b.date === dateStr);
        dayBookings.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
        
        let dayRevenue = 0;
        dayBookings.forEach(b => dayRevenue += b.amount);
        
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        if (dateStr === todayStr) {
            cell.classList.add('today');
        }
        
        // Click behavior
        cell.onclick = () => {
            document.getElementById('daily-date-picker').value = dateStr;
            loadDailyView();
            switchTab('daily');
        };
        
        let cellContent = `<div class="day-header-info">
            <div style="display: flex; align-items: center; gap: 4px;">
                <span class="day-number">${day}</span>
                ${dayBookings.length > 0 ? `<span class="day-bookings-count">${dayBookings.length}</span>` : ''}
            </div>`;
        if (dayBookings.length > 0) {
            cellContent += `<span class="day-revenue">${formatCurrency(dayRevenue)}</span></div>`;
            cellContent += `<div class="day-events-list">`;
            
            // Show up to 3 bookings in calendar cell to prevent layout breakage
            const maxVisible = 3;
            dayBookings.forEach((b, idx) => {
                if (idx < maxVisible) {
                    let displayTime = b.time;
                    if (displayTime.includes(' - ')) {
                        displayTime = displayTime.split(' - ')[0]; // E.g. "01:00 PM"
                    }
                    
                    let nameDisplay = b.name;
                    if (nameDisplay.length > 12) {
                        nameDisplay = nameDisplay.substring(0, 10) + '..';
                    }
                    
                    const badgeClass = `badge-${b.status.toLowerCase()}`;
                    cellContent += `
                        <div class="calendar-event-pill ${badgeClass}" title="${b.time} - ${b.name} (${b.status})">
                            <span class="event-time">${displayTime}</span>
                            <span class="event-name">${nameDisplay}</span>
                        </div>
                    `;
                }
            });
            
            if (dayBookings.length > maxVisible) {
                cellContent += `
                    <div class="calendar-event-more">
                        +${dayBookings.length - maxVisible} mais
                    </div>
                `;
            }
            cellContent += `</div>`;
        } else {
            cellContent += `</div>`;
        }
        
        cell.innerHTML = cellContent;
        grid.appendChild(cell);
    }
    
    // Pad remaining space for grid completeness (6 rows * 7 = 42 cells total)
    const totalCells = grid.children.length - 7; // subtract header elements
    const remaining = 35 - totalCells > 0 ? 35 - totalCells : (42 - totalCells);
    for (let i = 1; i <= remaining; i++) {
        if (grid.children.length >= 49) break; // Maximum 6 rows + header
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell inactive';
        cell.innerHTML = `<span class="day-number">${i}</span>`;
        grid.appendChild(cell);
    }
}

// 6. TAB 4: LISTA GERAL DE AGENDAMENTOS (DATATABLE)
function filterBookings() {
    const searchVal = document.getElementById('search-client').value.toLowerCase().strip();
    const statusVal = document.getElementById('filter-status').value;
    const paymentVal = document.getElementById('filter-payment').value;
    
    filteredBookings = bookings.filter(b => {
        // Search matches
        const matchesSearch = b.name.toLowerCase().includes(searchVal);
        
        // Status matches
        const matchesStatus = statusVal === 'all' || b.status.toLowerCase() === statusVal.toLowerCase();
        
        // Payment matches
        const matchesPayment = paymentVal === 'all' || b.payment_method.toLowerCase() === paymentVal.toLowerCase();
        
        return matchesSearch && matchesStatus && matchesPayment;
    });
    
    currentPage = 1;
    renderBookingsTable();
}

// Helper string method if not supported
if (!String.prototype.strip) {
    String.prototype.strip = function() {
        return this.trim();
    };
}

function renderBookingsTable() {
    const tbody = document.getElementById('bookings-table-body');
    tbody.innerHTML = '';
    
    const totalItems = filteredBookings.length;
    
    if (totalItems === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px;" class="view-subtitle">Nenhum agendamento encontrado para os filtros ativos.</td></tr>`;
        document.getElementById('pagination-info').innerText = `Sem registros`;
        document.getElementById('btn-prev').disabled = true;
        document.getElementById('btn-next').disabled = true;
        return;
    }
    
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    
    const pageItems = filteredBookings.slice(startIdx, endIdx);
    
    pageItems.forEach((b, index) => {
        const tr = document.createElement('tr');
        const statusClass = `badge-${b.status.toLowerCase()}`;
        
        // Find index of this booking in global array
        const globalIdx = bookings.findIndex(x => x.name === b.name && x.date === b.date && x.time === b.time);
        
        tr.innerHTML = `
            <td>${formatDateString(b.date)}</td>
            <td>${b.time}</td>
            <td style="font-weight: 700; color: var(--text-primary);">${b.name}</td>
            <td style="font-family: var(--font-heading); font-weight: 600;">${formatCurrency(b.amount)}</td>
            <td style="font-family: var(--font-heading); color: #10b981;">${b.tip > 0 ? formatCurrency(b.tip) : '-'}</td>
            <td>${b.payment_method}</td>
            <td><span class="badge ${statusClass}">${b.status}</span></td>
            <td>
                <button class="theme-toggle-btn" style="padding: 6px 12px; font-size: 0.75rem;" onclick="openDetailModal(${globalIdx})">
                    <i data-lucide="eye" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Ver
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Update pagination controls
    document.getElementById('pagination-info').innerText = `Mostrando ${startIdx + 1}-${endIdx} de ${totalItems} agendamentos`;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = endIdx >= totalItems;
    
    lucide.createIcons();
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderBookingsTable();
    }
}

function nextPage() {
    const totalItems = filteredBookings.length;
    if (currentPage * pageSize < totalItems) {
        currentPage++;
        renderBookingsTable();
    }
}

// 7. TAB 5: RELATÓRIOS & ANALYTICS
function loadAnalyticsTab() {
    setTimeout(() => {
        renderMonthlyRevenueChart();
        renderPaymentMethodsChart();
        renderStatusDistributionChart();
        renderTopClientsRanking();
    }, 100);
}

function renderMonthlyRevenueChart() {
    const ctx = document.getElementById('chart-monthly-revenue');
    if (!ctx) return;
    
    // Group revenue by Month
    const monthlyRev = {};
    bookings.forEach(b => {
        if (!b.date || !b.date.includes('-')) return;
        const parts = b.date.split('-');
        const monthYear = `${parts[0]}-${parts[1]}`; // e.g. "2026-07"
        monthlyRev[monthYear] = (monthlyRev[monthYear] || 0) + b.amount;
    });
    
    // Sort keys
    const sortedMonths = Object.keys(monthlyRev).sort();
    const data = sortedMonths.map(m => monthlyRev[m]);
    
    // Human readable labels
    const labels = sortedMonths.map(my => {
        const parts = my.split('-');
        const mIdx = parseInt(parts[1]) - 1;
        return `${monthsPt[mIdx].substring(0, 3)}/${parts[0].substring(2)}`;
    });
    
    if (chartMonthlyRevenue) {
        chartMonthlyRevenue.destroy();
    }
    
    const isDark = !document.body.classList.contains('light-theme');
    
    chartMonthlyRevenue = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Receita ($)',
                data: data,
                backgroundColor: 'rgba(16, 185, 129, 0.65)',
                borderColor: '#10b981',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
                    ticks: { color: isDark ? '#9ca3af' : '#4b5563', font: { family: 'Plus Jakarta Sans' } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: isDark ? '#9ca3af' : '#4b5563', font: { family: 'Plus Jakarta Sans' } }
                }
            }
        }
    });
}

function renderPaymentMethodsChart() {
    const ctx = document.getElementById('chart-payment-methods');
    if (!ctx) return;
    
    const counts = {};
    bookings.forEach(b => {
        counts[b.payment_method] = (counts[b.payment_method] || 0) + 1;
    });
    
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    
    if (chartPaymentMethods) {
        chartPaymentMethods.destroy();
    }
    
    const isDark = !document.body.classList.contains('light-theme');
    
    chartPaymentMethods = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#10b981',
                    '#6366f1',
                    '#f59e0b',
                    '#3b82f6',
                    '#0ea5e9',
                    '#8b5cf6'
                ],
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#121e18' : '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: isDark ? '#9ca3af' : '#4b5563',
                        font: { family: 'Plus Jakarta Sans', size: 11 }
                    }
                }
            }
        }
    });
}

function renderStatusDistributionChart() {
    const ctx = document.getElementById('chart-status-distribution');
    if (!ctx) return;
    
    const counts = {};
    bookings.forEach(b => {
        counts[b.status] = (counts[b.status] || 0) + 1;
    });
    
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    
    const colors = labels.map(label => {
        switch(label.toLowerCase()) {
            case 'paid': return '#10b981';
            case 'charged': return '#6366f1';
            case 'unassigned': return '#f59e0b';
            case 'upcoming': return '#3b82f6';
            case 'completed': return '#0ea5e9';
            default: return '#8b5cf6';
        }
    });
    
    if (chartStatusDistribution) {
        chartStatusDistribution.destroy();
    }
    
    const isDark = !document.body.classList.contains('light-theme');
    
    chartStatusDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#121e18' : '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: isDark ? '#9ca3af' : '#4b5563',
                        font: { family: 'Plus Jakarta Sans', size: 11 }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

function renderTopClientsRanking() {
    const clientSummary = {};
    bookings.forEach(b => {
        if (!clientSummary[b.name]) {
            clientSummary[b.name] = { count: 0, totalAmount: 0 };
        }
        clientSummary[b.name].count++;
        clientSummary[b.name].totalAmount += b.amount;
    });
    
    const sortedClients = Object.keys(clientSummary)
        .map(name => ({
            name: name,
            count: clientSummary[name].count,
            total: clientSummary[name].totalAmount
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
        
    const tbody = document.getElementById('top-clients-tbody');
    tbody.innerHTML = '';
    
    sortedClients.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 700; color: var(--primary);">${idx + 1}º</td>
            <td style="font-weight: 600; color: var(--text-primary);">${c.name}</td>
            <td>${c.count} serviços</td>
            <td style="font-weight: 700; font-family: var(--font-heading);">${formatCurrency(c.total)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 8. TAB 6: CONFIGURAÇÕES & IMPORTAÇÃO DE PLANILHA
function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (!dropZone) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleImportedFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImportedFile(e.target.files[0]);
        }
    });
}

function parseRowsToBookings(rawRows) {
    if (!rawRows || rawRows.length <= 1) return [];

    const headers = (rawRows[0] || []).map(h => String(h || '').trim().toLowerCase());

    const findColIndex = (keywords) => {
        // Try exact header match first
        for (const k of keywords) {
            const idx = headers.findIndex(h => h === k.toLowerCase());
            if (idx >= 0) return idx;
        }
        // Fallback to substring match
        for (const k of keywords) {
            const idx = headers.findIndex(h => h.includes(k.toLowerCase()));
            if (idx >= 0) return idx;
        }
        return -1;
    };

    const colStatus = findColIndex(['booking status', 'booking_status', 'status']);
    const colName = findColIndex(['full name', 'client name', 'nome', 'client', 'name']);
    const colStartDt = findColIndex(['booking start date time', 'start date time', 'start_date_time']);
    const colDate = findColIndex(['date', 'data']);
    const colTime = findColIndex(['time', 'horário', 'horario']);
    const colAmount = findColIndex(['final amount (usd)', 'final amount', 'amount', 'valor']);
    const colPayment = findColIndex(['payment method', 'payment_method', 'método', 'metodo', 'payment']);
    const colTip = findColIndex(['tip (usd)', 'tip', 'gorjeta']);
    const colProvider = findColIndex(['provider/team', 'provider', 'team', 'profissional', 'equipe']);
    const colBookingId = findColIndex(['booking id', 'booking_id']);
    const colClientId = findColIndex(['client id', 'client_id']);
    const colTxId = findColIndex(['transaction id', 'transaction_id']);
    const colPaymentDate = findColIndex(['payment date', 'payment_date']);

    const normalizeDateToISO = (dateVal, startDtVal) => {
        if (startDtVal && String(startDtVal).includes('T')) {
            return String(startDtVal).split('T')[0];
        }
        if (!dateVal) return "";
        const dateStr = String(dateVal).trim();
        if (dateStr.includes('T')) {
            return dateStr.split('T')[0];
        }
        if (/^\d+(\.\d+)?$/.test(dateStr)) {
            const val = parseFloat(dateStr);
            const dateObj = new Date(Date.UTC(1899, 11, 30) + val * 86400 * 1000);
            return dateObj.toISOString().split('T')[0];
        }
        const matchISO = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (matchISO) return matchISO[0];
        
        const matchUS = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (matchUS) {
            const month = matchUS[1].padStart(2, '0');
            const day = matchUS[2].padStart(2, '0');
            const year = matchUS[3];
            return `${year}-${month}-${day}`;
        }
        return dateStr;
    };

    const excelTimeToJS = (excelVal) => {
        let val = parseFloat(excelVal);
        if (isNaN(val)) return String(excelVal).trim();
        if (val > 1.0) {
            val = val - Math.floor(val);
        }
        const totalSeconds = Math.round(val * 86400);
        const hrs = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        
        let period = "AM";
        let dHrs = hrs;
        if (hrs >= 12) {
            period = "PM";
            if (hrs > 12) dHrs -= 12;
        }
        if (dHrs === 0) dHrs = 12;
        return `${String(dHrs).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${period}`;
    };

    const newBookings = [];

    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length < 2) continue;

        const nameIdx = colName >= 0 ? colName : 1;
        const rawName = row[nameIdx];
        if (!rawName || String(rawName).trim() === "") continue;

        const statusIdx = colStatus >= 0 ? colStatus : 0;
        const dateIdx = colDate >= 0 ? colDate : 2;
        const timeIdx = colTime >= 0 ? colTime : 3;
        const amountIdx = colAmount >= 0 ? colAmount : 4;
        const paymentIdx = colPayment >= 0 ? colPayment : 5;
        const tipIdx = colTip >= 0 ? colTip : 6;
        const providerIdx = colProvider >= 0 ? colProvider : -1;
        const bookingIdIdx = colBookingId >= 0 ? colBookingId : -1;
        const clientIdIdx = colClientId >= 0 ? colClientId : -1;
        const txIdIdx = colTxId >= 0 ? colTxId : -1;
        const paymentDateIdx = colPaymentDate >= 0 ? colPaymentDate : -1;

        const status = normalizeStatus(row[statusIdx]);
        const startDtVal = colStartDt >= 0 ? row[colStartDt] : null;
        const dateVal = normalizeDateToISO(row[dateIdx], startDtVal);

        let timeVal = row[timeIdx];
        if (timeVal) {
            timeVal = String(timeVal).trim();
            if (/^\d+(\.\d+)?$/.test(timeVal)) {
                timeVal = excelTimeToJS(timeVal);
            }
        } else {
            timeVal = "";
        }

        const amount = cleanAmount(row[amountIdx]);
        const payment = normalizePaymentMethod(row[paymentIdx]);
        const tip = cleanAmount(row[tipIdx]);
        const provider = providerIdx >= 0 && row[providerIdx] ? String(row[providerIdx]).trim() : "Unassigned";
        const bookingId = bookingIdIdx >= 0 && row[bookingIdIdx] !== null && row[bookingIdIdx] !== undefined ? String(row[bookingIdIdx]).replace(/\.0$/, '').trim() : "";
        const clientId = clientIdIdx >= 0 && row[clientIdIdx] ? String(row[clientIdIdx]).trim() : "";
        const txId = txIdIdx >= 0 && row[txIdIdx] ? String(row[txIdIdx]).trim() : "";
        const paymentDate = paymentDateIdx >= 0 && row[paymentDateIdx] ? normalizeDateToISO(row[paymentDateIdx]) : "-";

        const item = {
            status: status,
            name: String(rawName).trim(),
            date: dateVal,
            time: timeVal,
            amount: amount,
            payment_method: payment,
            tip: tip,
            total: Math.round((amount + tip) * 100) / 100,
            provider: provider,
            booking_id: bookingId,
            payment_date: paymentDate || "-"
        };
        if (clientId) item.client_id = clientId;
        if (txId) item.transaction_id = txId;

        newBookings.push(item);
    }

    return newBookings;
}

function handleImportedFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Prioritize 'New Bookings' sheet, fallback to 'Bookings' sheet or first sheet
            let sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'new bookings') ||
                            workbook.SheetNames.find(n => n.toLowerCase() === 'bookings') ||
                            workbook.SheetNames[0];
            
            if (!sheetName) {
                alert("Nenhuma planilha encontrada no arquivo.");
                return;
            }
            
            const sheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            if (rawRows.length <= 1) {
                alert("A planilha importada não possui registros.");
                return;
            }
            
            const newBookings = parseRowsToBookings(rawRows);
            
            if (newBookings.length > 0) {
                bookings = deduplicateBookings(newBookings);
                sortBookingsGlobal();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
                
                alert(`Importado com sucesso! ${bookings.length} agendamentos carregados da aba '${sheetName}'.`);
                refreshAllData();
            } else {
                alert("Nenhum registro válido encontrado para importar.");
            }
            
        } catch (err) {
            console.error("Erro na leitura do arquivo:", err);
            alert("Erro ao decodificar a planilha. Verifique a estrutura do arquivo.");
        }
    };
    reader.readAsArrayBuffer(file);
}

// 9. DETAILS MODAL WINDOW
function openDetailModal(idx) {
    if (idx < 0 || idx >= bookings.length) return;
    const b = bookings[idx];
    
    const content = document.getElementById('modal-body-content');
    const statusClass = `badge-${b.status.toLowerCase()}`;
    
    content.innerHTML = `
        ${b.booking_id ? `
        <div class="modal-info-row">
            <span class="modal-label">ID Agendamento</span>
            <span class="modal-value" style="font-weight: 600;">#${b.booking_id}</span>
        </div>` : ''}
        <div class="modal-info-row">
            <span class="modal-label">Cliente</span>
            <span class="modal-value" style="font-size: 1.1rem; color: var(--primary);">${b.name}</span>
        </div>
        ${b.provider && b.provider !== 'Unassigned' ? `
        <div class="modal-info-row">
            <span class="modal-label">Equipe / Profissional</span>
            <span class="modal-value">${b.provider}</span>
        </div>` : ''}
        <div class="modal-info-row">
            <span class="modal-label">Data do Serviço</span>
            <span class="modal-value">${formatDateString(b.date)}</span>
        </div>
        <div class="modal-info-row">
            <span class="modal-label">Horário</span>
            <span class="modal-value">${b.time}</span>
        </div>
        <div class="modal-info-row">
            <span class="modal-label">Valor do Serviço</span>
            <span class="modal-value" style="font-family: var(--font-heading);">${formatCurrency(b.amount)}</span>
        </div>
        <div class="modal-info-row">
            <span class="modal-label">Gorjeta (Tip)</span>
            <span class="modal-value" style="font-family: var(--font-heading); color: #10b981;">${formatCurrency(b.tip)}</span>
        </div>
        <div class="modal-info-row" style="background: var(--primary-glow); padding: 12px; border-radius: 12px; margin-top: 8px;">
            <span class="modal-label" style="color: var(--primary-light);">Total</span>
            <span class="modal-value" style="font-family: var(--font-heading); font-size: 1.2rem; color: var(--primary-light);">${formatCurrency(b.total)}</span>
        </div>
        <div class="modal-info-row">
            <span class="modal-label">Método de Pagamento</span>
            <span class="modal-value">${b.payment_method}</span>
        </div>
        <div class="modal-info-row">
            <span class="modal-label">Status</span>
            <span class="badge ${statusClass}">${b.status}</span>
        </div>
    `;
    
    document.getElementById('detail-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
}

function closeDetailModal(e) {
    if (e.target.id === 'detail-modal') {
        closeModal();
    }
}

// 10. SYSTEM THEMES AND CUSTOMIZATION
function toggleTheme() {
    const isDark = !document.body.classList.contains('light-theme');
    const newTheme = isDark ? 'light' : 'dark';
    
    setThemeMode(newTheme);
}

function setThemeMode(mode) {
    const isLight = mode === 'light';
    document.body.className = isLight ? 'light-theme' : '';
    
    // Toggle active state on settings buttons if they exist
    const btnDark = document.getElementById('btn-theme-dark');
    const btnLight = document.getElementById('btn-theme-light');
    if (btnDark) btnDark.className = isLight ? 'theme-toggle-btn' : 'theme-toggle-btn active';
    if (btnLight) btnLight.className = isLight ? 'theme-toggle-btn active' : 'theme-toggle-btn';
    
    localStorage.setItem('theme', mode);
    updateThemeUI(mode);
    
    // Recreate charts with themed colors based on active tab
    if (currentTab === 'dashboard') {
        loadDashboardTab();
    } else if (currentTab === 'analytics') {
        loadAnalyticsTab();
    }
}

function updateThemeUI(theme) {
    const icon = document.getElementById('theme-icon');
    if (!icon) return;
    
    if (theme === 'light') {
        icon.setAttribute('data-lucide', 'sun');
    } else {
        icon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
}

function changeBlur(val) {
    document.documentElement.style.setProperty('--glass-blur', `${val}px`);
    localStorage.setItem('glass_blur', val);
}

function resetSystemData() {
    if (confirm("Tem certeza que deseja restaurar os dados originais da planilha? Todas as modificações manuais serão perdidas.")) {
        localStorage.removeItem('north_bookings');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_VERSION_KEY);
        bookings = [...window.INITIAL_BOOKINGS];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
        
        // Reset picker
        selectedDailyDate = getAtlantaDateString();
        document.getElementById('daily-date-picker').value = selectedDailyDate;
        document.getElementById('dashboard-date-picker').value = selectedDailyDate;
        
        refreshAllData();
        alert("Sistema restaurado para o banco de dados padrão!");
    }
}

// Online mock sync for presentation
async function syncDataOnline() {
    const syncBtn = document.querySelector('.sync-btn');
    if (!syncBtn) return;
    
    const originalContent = syncBtn.innerHTML;
    syncBtn.disabled = true;
    syncBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" style="width: 16px; height: 16px; display: inline-block;"></i> <span>Sincronizando...</span>`;
    lucide.createIcons();
    
    try {
        const sheetUrl = "https://docs.google.com/spreadsheets/d/10Or1J8nzgEXgyVJ0Y_0QDnpxRsqXF2Ywxbm-VF6figo/export?format=xlsx";
        const response = await fetch(sheetUrl);
        if (!response.ok) {
            throw new Error(`Falha ao baixar planilha: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'new bookings') ||
                        workbook.SheetNames.find(n => n.toLowerCase() === 'bookings') ||
                        workbook.SheetNames[0];
        
        if (!sheetName) {
            throw new Error("Aba de agendamentos não encontrada.");
        }
        
        const sheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (rawRows.length <= 1) {
            throw new Error("Planilha vazia.");
        }
        
        const newBookings = parseRowsToBookings(rawRows);
        
        if (newBookings.length > 0) {
            bookings = deduplicateBookings(newBookings);
            sortBookingsGlobal();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
            
            refreshAllData();
            alert(`Sincronização concluída! ${bookings.length} agendamentos atualizados da aba '${sheetName}'.`);
        } else {
            alert("Nenhum agendamento válido para importar.");
        }
    } catch (err) {
        console.error("Erro na sincronização:", err);
        alert(`Erro na sincronização: ${err.message}`);
    } finally {
        syncBtn.innerHTML = originalContent;
        syncBtn.disabled = false;
        lucide.createIcons();
    }
}

function parseCSVToRows(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const row = [];
        let insideQuote = false;
        let entry = '';
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                if (insideQuote && line[j + 1] === '"') {
                    entry += '"';
                    j++;
                } else {
                    insideQuote = !insideQuote;
                }
            } else if (char === ',' && !insideQuote) {
                row.push(entry);
                entry = '';
            } else {
                entry += char;
            }
        }
        row.push(entry);
        result.push(row);
    }
    return result;
}

function updateLiveIndicator(isOnline, lastSyncTime) {
    const badge = document.getElementById('live-status-indicator');
    if (!badge || typeof badge.querySelector !== 'function') return;
    const textEl = badge.querySelector('.live-text');
    if (isOnline) {
        badge.classList.remove('offline');
        if (textEl) {
            const timeStr = lastSyncTime ? lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            textEl.innerText = timeStr ? `Ao Vivo (${timeStr})` : 'Ao Vivo';
        }
    } else {
        badge.classList.add('offline');
        if (textEl) textEl.innerText = 'Off-line';
    }
}

async function syncDataOnlineSilently() {
    try {
        const csvUrl = "https://docs.google.com/spreadsheets/d/10Or1J8nzgEXgyVJ0Y_0QDnpxRsqXF2Ywxbm-VF6figo/gviz/tq?tqx=out:csv&sheet=New%20Bookings";
        const response = await fetch(csvUrl);
        if (!response.ok) {
            updateLiveIndicator(false);
            return;
        }
        
        const csvText = await response.text();
        if (!csvText || csvText.length < 500) {
            updateLiveIndicator(false);
            return;
        }
        
        const rawRows = parseCSVToRows(csvText);
        if (!rawRows || rawRows.length <= 1) {
            updateLiveIndicator(false);
            return;
        }
        
        const newBookings = parseRowsToBookings(rawRows);
        if (newBookings.length >= 100) {
            const deduped = deduplicateBookings(newBookings);
            
            const newStr = JSON.stringify(deduped);
            const curStr = JSON.stringify(bookings);
            
            if (newStr !== curStr) {
                bookings = deduped;
                sortBookingsGlobal();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
                refreshAllData();
                console.log("⚡ Dashboard atualizada automaticamente em tempo real via Google Sheets CSV.");
            }
            updateLiveIndicator(true, new Date());
        }
    } catch (e) {
        console.warn("Erro na sincronização em tempo real:", e);
        updateLiveIndicator(false);
    }
}

// Deduplicate bookings by name, date and time slot to match BookingKoala's active calendar UI
function deduplicateBookings(arr) {
    if (!arr || !Array.isArray(arr)) return [];
    const bookingMap = new Map();
    
    // Placeholder template client names that BK omits on calendar view when unassigned
    const placeholders = new Set([
        'marc buraczynski', 'jeff wong', 'judy webb', 'jenny vernet', 'lakirah walker', 
        'jacquelyn hutchison', 'tanya becker', 'josie arms', 'travis brown', 'ishia ussery', 
        'may tan', 'faith morgan wroten', 'christi and matthew rodriguez', 'lariel toomer'
    ]);

    for (const b of arr) {
        if (!b || !b.name || !b.date) continue;

        const nameLower = String(b.name).toLowerCase().trim();
        const status = String(b.status || 'Unassigned').trim();
        const provider = String(b.provider || 'Unassigned').trim();

        // Skip unassigned recurring template placeholders that are hidden in BookingKoala calendar
        if (status === 'Unassigned' && provider === 'Unassigned' && placeholders.has(nameLower)) {
            continue;
        }
        
        const cleanTime = String(b.time || "").trim();
        let hourPart = "12 AM";
        const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
            hourPart = `${timeMatch[1].padStart(2, '0')} ${timeMatch[3].toUpperCase()}`;
        } else if (cleanTime) {
            const simpleMatch = cleanTime.match(/^(\d{1,2})/);
            if (simpleMatch) {
                hourPart = `${simpleMatch[1].padStart(2, '0')} AM`;
            }
        }
        
        const key = `${nameLower}|${b.date}|${hourPart}`;
        
        if (bookingMap.has(key)) {
            const existing = bookingMap.get(key);
            
            if (cleanTime.includes(' - ') && !String(existing.time || "").includes(' - ')) {
                existing.time = b.time;
            }
            if (b.payment_method && b.payment_method !== 'Unspecified' && 
                (!existing.payment_method || existing.payment_method === 'Unspecified' || existing.payment_method.toLowerCase() === 'cash')) {
                existing.payment_method = b.payment_method;
            }
            if (b.payment_date && b.payment_date !== '-' && (!existing.payment_date || existing.payment_date === '-')) {
                existing.payment_date = b.payment_date;
            }
            const statusRank = { 'Paid': 5, 'Charged': 4, 'Completed': 3, 'Upcoming': 2, 'Unassigned': 1 };
            const curRank = statusRank[b.status] || 0;
            const exRank = statusRank[existing.status] || 0;
            if (curRank > exRank) {
                existing.status = b.status;
            }
            if (b.provider && b.provider !== 'Unassigned' && (!existing.provider || existing.provider === 'Unassigned')) {
                existing.provider = b.provider;
            }
            if (b.amount > existing.amount) {
                existing.amount = b.amount;
            }
            if (b.tip > existing.tip) {
                existing.tip = b.tip;
            }
            existing.total = Math.round(((existing.amount || 0) + (existing.tip || 0)) * 100) / 100;
        } else {
            bookingMap.set(key, { ...b });
        }
    }
    
    return Array.from(bookingMap.values());
}

function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(val);
}

function formatDateString(dateStr) {
    if (!dateStr || !dateStr.includes('-')) return dateStr;
    const parts = dateStr.split('-');
    // Date displays in DD/MM/YYYY
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function cleanAmount(val) {
    if (val === undefined || val === null) return 0.0;
    const cleanStr = String(val).replace('$', '').replace(',', '').trim();
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0.0 : parsed;
}

function normalizeStatus(status) {
    if (!status) return "Unassigned";
    const s = String(status).trim().toLowerCase();
    if (s === "unassigned") return "Unassigned";
    if (s === "paid") return "Paid";
    if (s === "charged") return "Charged";
    if (s === "completed") return "Completed";
    if (s === "upcoming") return "Upcoming";
    return String(status).trim().charAt(0).toUpperCase() + String(status).trim().slice(1);
}

function normalizePaymentMethod(pm) {
    if (!pm) return "Cash/Check";
    const s = String(pm).trim();
    if (!s || s.toLowerCase() === "none" || s.toLowerCase() === "unspecified") return "Cash/Check";
    return s;
}

function getAtlantaDateString() {
    try {
        const now = new Date();
        const nyDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        if (/^\d{4}-\d{2}-\d{2}$/.test(nyDateStr)) {
            return nyDateStr;
        }
    } catch (e) {}
    
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    
    let timePart = timeStr.trim();
    if (timePart.includes(' - ')) {
        timePart = timePart.split(' - ')[0].trim();
    }
    
    const match24 = timePart.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
    }
    
    const match12 = timePart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const minutes = parseInt(match12[2], 10);
        const period = match12[3].toUpperCase();
        
        if (period === 'PM' && hours < 12) {
            hours += 12;
        } else if (period === 'AM' && hours === 12) {
            hours = 0;
        }
        
        return hours * 60 + minutes;
    }
    
    return 0;
}

function sortBookingsGlobal() {
    bookings.sort((a, b) => {
        if (a.date !== b.date) {
            return a.date < b.date ? -1 : 1; // Date ascending
        }
        return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time); // Time ascending
    });
}
