import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl } from '../api';

const formatCurrency = (value, currency = 'USD') => {
  const amount = Number(value || 0);
  return currency === 'BS'
    ? `BS ${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`
    : `$${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
};

const createEmptyForm = () => ({
  title: '',
  description: '',
  price: '',
  stock: '',
  club_id: '1',
  type: 'local',
  image_url: '',
  image_urls: '',
  dorsal_options: '',
  is_active: true
});

const createEmptyClubForm = () => ({
  name: '',
  country: '',
  logo_url: ''
});

const AdminPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeLog, setActiveLog] = useState(null);
  const [activeView, setActiveView] = useState(new URLSearchParams(location.search).get('view') || 'overview');
  const [form, setForm] = useState(createEmptyForm());
  const [message, setMessage] = useState('');
  const [inventory, setInventory] = useState([]);
  const [editingProductId, setEditingProductId] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [clubs, setClubs] = useState([]);
  const [clubForm, setClubForm] = useState(createEmptyClubForm());
  const [editingClubId, setEditingClubId] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(36);
  const [exchangeRateDraft, setExchangeRateDraft] = useState('36');
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});
  const [closurePeriod, setClosurePeriod] = useState('day');
  const [closureDate, setClosureDate] = useState(new Date().toISOString().split('T')[0]);
  const [closureSummary, setClosureSummary] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isResettingMetrics, setIsResettingMetrics] = useState(false);

  const parseImageUrls = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  };

  useEffect(() => {
    const nextView = new URLSearchParams(location.search).get('view') || 'overview';
    setActiveView(nextView);
  }, [location.search]);

  const loadDashboard = async () => {
    const token = localStorage.getItem('token');
    try {
      const [dashRes, ordersRes, auditsRes, inventoryRes, clubsRes, rateRes] = await Promise.all([
        fetch(apiUrl('/api/admin/dashboard'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/orders'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/audit-logs'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/products'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/clubs'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/exchange-rate'), { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const dashboardData = await dashRes.json();
      const ordersData = await ordersRes.json();
      const auditLogsData = await auditsRes.json();
      const inventoryData = await inventoryRes.json();
      const clubsData = await clubsRes.json();
      const rateData = await rateRes.json().catch(() => ({ exchangeRate: 36 }));
      setDashboard(dashboardData);
      setOrders(Array.isArray(ordersData) ? ordersData : []);
      setAuditLogs(Array.isArray(auditLogsData) ? auditLogsData : []);
      setInventory(Array.isArray(inventoryData) ? inventoryData : []);
      setClubs(Array.isArray(clubsData) ? clubsData : []);
      setExchangeRate(Number(rateData.exchangeRate || 36));
      setExchangeRateDraft(String(rateData.exchangeRate || 36));
    } catch (error) {
      setMessage('No se pudo cargar la información del panel.');
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const updateStatus = async (orderId, status) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/orders/${orderId}/status`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ status })
      });
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = { id: orderId };
      }
      if (response.ok) {
        setOrders((current) => current.map((item) => item.id === data.id ? { ...item, status } : item));
      }
    } catch (error) {
      setMessage('No se pudo actualizar el pedido.');
    }
  };

  const handleCreateProduct = async (event) => {
    event.preventDefault();
    setMessage('');

    const imageUrls = parseImageUrls(form.image_urls);

    const response = await fetch(apiUrl('/api/products'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({
        ...form,
        image_url: form.image_url || imageUrls[0] || null,
        image_urls: imageUrls,
        price: Number(form.price),
        stock: Number(form.stock),
        club_id: Number(form.club_id),
        is_active: form.is_active
      })
    });

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = { error: 'Respuesta vacía del servidor' };
    }

    if (!response.ok) {
      setMessage(data.error || 'No se pudo crear la camiseta');
      return;
    }

    setMessage(`Camiseta creada correctamente: ${data.title}`);
    setForm(createEmptyForm());
    setEditingProductId(null);
    setShowCreateForm(false);
    loadDashboard();
  };

  const handleDeleteProduct = async (productId) => {
    const response = await fetch(apiUrl(`/api/products/${productId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      setMessage('Camiseta eliminada');
      loadDashboard();
    }
  };

  const handleEditProduct = async (product) => {
    const response = await fetch(apiUrl(`/api/products/${product.id}`));
    const detailedProduct = response.ok ? await response.json() : product;
    setEditingProductId(product.id);
    setForm({
      title: detailedProduct.title || '',
      description: detailedProduct.description || '',
      price: detailedProduct.price ?? '',
      stock: detailedProduct.stock ?? '',
      club_id: detailedProduct.club_id ?? '1',
      type: detailedProduct.type || 'local',
      image_url: detailedProduct.image_url || '',
      image_urls: Array.isArray(detailedProduct.image_urls) ? detailedProduct.image_urls.join(', ') : '',
      dorsal_options: Array.isArray(detailedProduct.dorsals) ? detailedProduct.dorsals.map((item) => item.dorsal_number).join(', ') : '',
      is_active: detailedProduct.is_active !== false
    });
    setShowCreateForm(true);
  };

  const handleUpdateProduct = async (event) => {
    event.preventDefault();
    if (!editingProductId) return;

    const imageUrls = parseImageUrls(form.image_urls);

    const response = await fetch(apiUrl(`/api/products/${editingProductId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({
        ...form,
        image_url: form.image_url || imageUrls[0] || null,
        image_urls: imageUrls,
        price: Number(form.price),
        stock: Number(form.stock),
        club_id: Number(form.club_id),
        is_active: form.is_active
      })
    });

    if (response.ok) {
      setMessage('Camiseta actualizada');
      setEditingProductId(null);
      setForm(createEmptyForm());
      setShowCreateForm(false);
      loadDashboard();
    }
  };

  const loadOrderDetail = async (orderId) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    if (orderDetails[orderId]) {
      setExpandedOrderId(orderId);
      return;
    }

    const token = localStorage.getItem('token');
    try {
      const response = await fetch(apiUrl(`/api/orders/${orderId}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setOrderDetails((current) => ({ ...current, [orderId]: data }));
      setExpandedOrderId(orderId);
    } catch (error) {
      setMessage('No se pudo cargar el detalle del pedido.');
    }
  };

  const updateExchangeRate = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch(apiUrl('/api/admin/exchange-rate'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rate: Number(exchangeRateDraft) })
    });
    if (response.ok) {
      const data = await response.json();
      setExchangeRate(Number(data.exchangeRate || 36));
      setExchangeRateDraft(String(data.exchangeRate || 36));
      setMessage('Tasa de cambio actualizada');
      loadDashboard();
    }
  };

  const resetRevenueMetrics = async () => {
    if (!window.confirm('Se reiniciaran las metricas de dinero recaudado desde este momento. Los pedidos no se eliminaran. ¿Continuar?')) return;
    setIsResettingMetrics(true);
    try {
      const response = await fetch(apiUrl('/api/admin/metrics/reset'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('No se pudieron restablecer las metricas');
      setMessage('Metricas de dinero recaudado restablecidas');
      await loadDashboard();
    } catch (error) {
      setMessage('No se pudieron restablecer las metricas.');
    } finally {
      setIsResettingMetrics(false);
    }
  };

  const loadClosureSummary = async (periodType = closurePeriod, referenceDate = closureDate) => {
    const token = localStorage.getItem('token');
    const response = await fetch(apiUrl(`/api/admin/closures?period=${periodType}&date=${referenceDate}`), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    setClosureSummary(data);
    return data;
  };

  const createClosure = async () => {
    setIsClosing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(apiUrl('/api/admin/closures'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ periodType: closurePeriod, referenceDate: closureDate })
      });
      if (!response.ok) {
        throw new Error('No se pudo generar el cierre');
      }
      const data = await response.json();
      setClosureSummary(data);
      setMessage(`Cierre generado para ${data.periodLabel}`);
    } catch (error) {
      setMessage('No se pudo generar el cierre financiero.');
    } finally {
      setIsClosing(false);
    }
  };

  const printClosure = () => {
    if (!closureSummary) return;
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) return;
    const rows = (closureSummary.orders || []).map((order) => `
      <tr>
        <td>#${order.id}</td>
        <td>${new Date(order.createdAt).toLocaleString('es-VE')}</td>
        <td>${formatCurrency(order.totalAmount, 'USD')}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Cierre ${closureSummary.periodLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
            .summary div { border: 1px solid #e2e8f0; padding: 10px; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }
            .muted { color: #64748b; }
          </style>
        </head>
        <body>
          <h1>Cierre ${closureSummary.periodLabel}</h1>
          <p class="muted">Periodo: ${closureSummary.periodType === 'day' ? 'Diario' : closureSummary.periodType === 'month' ? 'Mensual' : 'Anual'}</p>
          <div class="summary">
            <div><strong>Total</strong><br />${formatCurrency(closureSummary.totalAmount, 'USD')}</div>
            <div><strong>Pedidos</strong><br />${closureSummary.ordersCount}</div>
            <div><strong>Unidades</strong><br />${closureSummary.itemsSold}</div>
          </div>
          <table>
            <thead>
              <tr><th># Pedido</th><th>Fecha</th><th>Monto</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSubmitClub = async (event) => {
    event.preventDefault();
    const method = editingClubId ? 'PUT' : 'POST';
    const url = editingClubId ? apiUrl(`/api/admin/clubs/${editingClubId}`) : apiUrl('/api/admin/clubs');
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(clubForm)
    });
    if (response.ok) {
      setMessage(editingClubId ? 'Club actualizado' : 'Club registrado');
      setClubForm(createEmptyClubForm());
      setEditingClubId(null);
      loadDashboard();
    }
  };

  const handleEditClub = (club) => {
    setEditingClubId(club.id);
    setClubForm({ name: club.name || '', country: club.country || '', logo_url: club.logo_url || '' });
  };

  const handleDeleteClub = async (clubId) => {
    const response = await fetch(apiUrl(`/api/admin/clubs/${clubId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      setMessage('Club eliminado');
      loadDashboard();
    }
  };

  const setView = (view) => {
    setActiveView(view);
    navigate(`/admin?view=${view}`);
  };

  const getProofUrl = (value) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;

    const backendBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

    if (value.startsWith('/uploads') || value.startsWith('uploads')) {
      return new URL(value.replace(/^\//, ''), `${backendBase}/`).toString();
    }

    return value;
  };

  const downloadInvoice = async (orderId) => {
    try {
      const response = await fetch(apiUrl(`/api/orders/${orderId}/invoice`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        setMessage('No se pudo descargar la factura.');
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `factura-pedido-${orderId}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('Factura descargada correctamente.');
    } catch (error) {
      setMessage('No se pudo descargar la factura.');
    }
  };

  if (!dashboard) return <div className="container">Cargando...</div>;

  const pendingOrders = orders.filter((order) => order.status === 'pending');
  const processedOrders = orders.filter((order) => ['approved', 'rejected'].includes(order.status));

  return (
    <div className="container">
      <section className="hero">
        <h2>Panel administrativo</h2>
        <p>Gestión de stock, pedidos, clubes y auditoría.</p>
      </section>

      <div className="admin-nav">
        <button className={`ghost-btn ${activeView === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Resumen</button>
        <button className={`ghost-btn ${activeView === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')}>Inventario</button>
        <button className={`ghost-btn ${activeView === 'clubs' ? 'active' : ''}`} onClick={() => setView('clubs')}>Clubes</button>
        <button className={`ghost-btn ${activeView === 'orders' ? 'active' : ''}`} onClick={() => setView('orders')}>Pedidos</button>
        <button className={`ghost-btn ${activeView === 'audit' ? 'active' : ''}`} onClick={() => setView('audit')}>Auditoría</button>
      </div>

      {message ? <p className="badge" style={{ marginBottom: '1rem' }}>{message}</p> : null}

      {activeView === 'overview' ? (
        <div className="dashboard-shell" style={{ marginBottom: '1rem' }}>
          <div className="card dashboard-hero">
            <div>
              <p className="eyebrow">Panel financiero</p>
              <h3>Resumen general del negocio</h3>
              <p>Controla ventas, ingresos en USD y BS, inventario y pedidos desde un único dashboard.</p>
            </div>
            <div className="dashboard-rate-box">
              <span>Tasa actual</span>
              <strong>{exchangeRate.toFixed(2)} BS/USD</strong>
              <div className="dashboard-rate-actions">
                <input type="number" min="1" step="0.01" value={exchangeRateDraft} onChange={(e) => setExchangeRateDraft(e.target.value)} />
                <button className="primary-btn" onClick={updateExchangeRate}>Guardar</button>
              </div>
              <button className="ghost-btn" onClick={resetRevenueMetrics} disabled={isResettingMetrics}>
                {isResettingMetrics ? 'Restableciendo...' : 'Restablecer métricas'}
              </button>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="card">
              <h3>Ingresos USD</h3>
              <p className="metric-value">{formatCurrency(dashboard.revenueUsd, 'USD')}</p>
              <span className="metric-caption">Ventas aprobadas</span>
            </div>
            <div className="card">
              <h3>Ingresos BS</h3>
              <p className="metric-value">{formatCurrency(dashboard.revenueBs, 'BS')}</p>
              <span className="metric-caption">Según la tasa actual</span>
            </div>
            <div className="card">
              <h3>Productos registrados</h3>
              <p className="metric-value">{dashboard.totalProducts}</p>
            </div>
            <div className="card">
              <h3>Unidades vendidas</h3>
              <p className="metric-value">{dashboard.soldItems}</p>
            </div>
            <div className="card">
              <h3>Pedidos pendientes</h3>
              <p className="metric-value">{dashboard.pendingOrders}</p>
            </div>
            <div className="card">
              <h3>Alertas de stock</h3>
              <p className="metric-value">{dashboard.lowStock.length}</p>
            </div>
          </div>

          <div className="dashboard-grid dashboard-grid--wide">
            <div className="card">
              <h3>Top productos</h3>
              <ul className="dashboard-list">
                {dashboard.topProducts?.length ? dashboard.topProducts.map((item) => (
                  <li key={item.name}><span>{item.name}</span><strong>{item.qty} und.</strong></li>
                )) : <li><span>No hay ventas aprobadas</span></li>}
              </ul>
            </div>
            <div className="card">
              <h3>Más vendida</h3>
              <p className="metric-value">{dashboard.bestSeller?.name || 'Sin ventas'}</p>
              <span className="metric-caption">{dashboard.bestSeller ? `${dashboard.bestSeller.qty} unidades` : 'Todavía no hay ventas aprobadas'}</span>
            </div>
          </div>

          <div className="card">
            <h3>Progreso de ingresos</h3>
            <svg viewBox="0 0 320 140" className="dashboard-chart" role="img" aria-label="Gráfico de ingresos"> 
              {dashboard.revenueTrend?.length ? (
                <>
                  <line x1="20" y1="120" x2="300" y2="120" stroke="#cbd5e1" strokeWidth="1" />
                  {dashboard.revenueTrend.map((point, index) => {
                    const max = Math.max(...dashboard.revenueTrend.map((item) => item.usd), 1);
                    const barHeight = (Number(point.usd) / max) * 90;
                    const x = 40 + index * 52;
                    const y = 120 - barHeight;
                    return (
                      <g key={point.month}>
                        <rect x={x} y={y} width="24" height={barHeight} rx="6" fill="#2563eb" />
                        <text x={x + 12} y="136" textAnchor="middle" fontSize="9" fill="#64748b">{point.month.slice(-2)}</text>
                      </g>
                    );
                  })}
                </>
              ) : <text x="160" y="70" textAnchor="middle" fill="#64748b">Sin ventas aprobadas</text>}
            </svg>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="filters-card__header" style={{ marginBottom: '0.75rem' }}>
              <div>
                <h3>Cierre de ingresos</h3>
                <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Consulta y genera el cierre diario, mensual o anual para imprimirlo después.</p>
              </div>
            </div>
            <div className="filter-grid" style={{ marginBottom: '0.75rem' }}>
              <select value={closurePeriod} onChange={(e) => setClosurePeriod(e.target.value)}>
                <option value="day">Diario</option>
                <option value="month">Mensual</option>
                <option value="year">Anual</option>
              </select>
              <input type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="ghost-btn" onClick={() => loadClosureSummary(closurePeriod, closureDate)}>Ver cierre</button>
              <button className="primary-btn" onClick={createClosure} disabled={isClosing}>{isClosing ? 'Generando...' : 'Cerrar y guardar'}</button>
              <button className="ghost-btn" onClick={printClosure} disabled={!closureSummary}>Imprimir</button>
            </div>
            {closureSummary ? (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.6rem' }}>
                <div className="dashboard-grid dashboard-grid--wide">
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Resumen</h4>
                    <p style={{ margin: 0 }}><strong>{closureSummary.periodLabel}</strong></p>
                    <p style={{ margin: '0.25rem 0 0' }}>{formatCurrency(closureSummary.totalAmount, 'USD')}</p>
                  </div>
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Pedidos</h4>
                    <p style={{ margin: 0 }}>{closureSummary.ordersCount} pedidos</p>
                    <p style={{ margin: '0.25rem 0 0' }}>{closureSummary.itemsSold} unidades</p>
                  </div>
                </div>
                <ul className="dashboard-list">
                  {(closureSummary.orders || []).map((order) => (
                    <li key={order.id}><span>Pedido #{order.id}</span><strong>{formatCurrency(order.totalAmount, 'USD')}</strong></li>
                  ))}
                </ul>
              </div>
            ) : <p style={{ color: '#64748b', marginTop: '0.75rem' }}>Selecciona un rango y genera el cierre para ver el resumen.</p>}
          </div>
        </div>
      ) : null}

      {activeView === 'inventory' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Inventario</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Gestiona camisetas, stock e imágenes desde aquí.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="ghost-btn" onClick={() => {
                setEditingProductId(null);
                setForm(createEmptyForm());
                setShowCreateForm((current) => !current);
              }}>
                {showCreateForm ? 'Cerrar' : 'Agregar camiseta'}
              </button>
              {editingProductId ? (
                <button className="ghost-btn" onClick={() => {
                  setEditingProductId(null);
                  setForm(createEmptyForm());
                  setShowCreateForm(false);
                }}>Cancelar edición</button>
              ) : null}
            </div>
          </div>

          {showCreateForm ? (
            <form className="inventory-form" onSubmit={editingProductId ? handleUpdateProduct : handleCreateProduct}>
              <div className="filter-grid">
                <input required placeholder="Nombre de la camiseta" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <input required type="number" min="0" step="0.01" placeholder="Precio" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                <input required type="number" min="0" placeholder="Stock" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                <input required type="number" placeholder="Club ID" value={form.club_id} onChange={(e) => setForm({ ...form, club_id: e.target.value })} />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="local">Local</option>
                  <option value="visitante">Visitante</option>
                  <option value="tercera">Tercera</option>
                </select>
                <input placeholder="Imagen principal" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
              </div>
              <input placeholder="Más imágenes (separadas por comas)" value={form.image_urls} onChange={(e) => setForm({ ...form, image_urls: e.target.value })} />
              <input placeholder="Dorsales disponibles (ej: 10, 11, 7)" value={form.dorsal_options} onChange={(e) => setForm({ ...form, dorsal_options: e.target.value })} />
              <textarea rows="3" placeholder="Descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#475569' }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Visible en el catálogo
              </label>
              <button className="primary-btn" type="submit">{editingProductId ? 'Actualizar camiseta' : 'Guardar camiseta'}</button>
            </form>
          ) : null}

          <div className="inventory-grid" style={{ marginTop: '1rem' }}>
            {inventory.length ? inventory.map((product) => (
              <div className="inventory-item" key={product.id}>
                <strong>{product.title}</strong>
                <span>{product.club?.name || 'Club sin asignar'}</span>
                <span>Stock: {product.stock}</span>
                <span>Precio: ${Number(product.price).toFixed(2)}</span>
                <div className="inventory-item__actions">
                  <button className="ghost-btn" onClick={() => handleEditProduct(product)}>Editar</button>
                  <button className="ghost-btn" onClick={() => handleDeleteProduct(product.id)}>Eliminar</button>
                </div>
              </div>
            )) : <p style={{ color: '#64748b' }}>Todavía no hay camisetas registradas.</p>}
          </div>
        </div>
      ) : null}

      {activeView === 'clubs' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Clubes</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Registra y administra los clubes que aparecerán en el catálogo.</p>
            </div>
          </div>
          <form className="inventory-form" onSubmit={handleSubmitClub}>
            <div className="filter-grid">
              <input required placeholder="Nombre del club" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} />
              <input placeholder="País" value={clubForm.country} onChange={(e) => setClubForm({ ...clubForm, country: e.target.value })} />
              <input placeholder="URL del logo" value={clubForm.logo_url} onChange={(e) => setClubForm({ ...clubForm, logo_url: e.target.value })} />
            </div>
            <button className="primary-btn" type="submit">{editingClubId ? 'Actualizar club' : 'Registrar club'}</button>
          </form>
          <div className="inventory-grid" style={{ marginTop: '1rem' }}>
            {clubs.map((club) => (
              <div className="inventory-item" key={club.id}>
                <strong>{club.name}</strong>
                <span>{club.country || 'Sin país'}</span>
                <div className="inventory-item__actions">
                  <button className="ghost-btn" onClick={() => handleEditClub(club)}>Editar</button>
                  <button className="ghost-btn" onClick={() => handleDeleteClub(club.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeView === 'orders' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>Pedidos pendientes</h3>
          {pendingOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Comprobante</th>
                  <th>Detalle</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map((order) => (
                  <tr key={order.id}>
                    <td>#{order.id}</td>
                    <td>{order.client?.name}</td>
                    <td>
                      <div>{formatCurrency(order.total_amount, 'USD')}</div>
                      <div className="price-bs">{formatCurrency(Number(order.total_amount) * exchangeRate, 'BS')}</div>
                    </td>
                    <td>
                      {order.payment_proof_url ? (
                        <a href={getProofUrl(order.payment_proof_url)} target="_blank" rel="noreferrer" title="Ver comprobante" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '999px', background: '#eff6ff', color: '#2563eb', textDecoration: 'none' }}>
                          👁️
                        </a>
                      ) : <span className="badge">Sin comprobante</span>}
                    </td>
                    <td>
                      <button className="ghost-btn" onClick={() => loadOrderDetail(order.id)}>{expandedOrderId === order.id ? 'Ocultar' : 'Ver productos'}</button>
                    </td>
                    <td>
                      <button className="ghost-btn" onClick={() => updateStatus(order.id, 'approved')}>Aprobar</button>
                      <button className="ghost-btn" onClick={() => updateStatus(order.id, 'rejected')}>Rechazar</button>
                      <button className="ghost-btn" onClick={() => downloadInvoice(order.id)}>Factura</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#64748b' }}>No hay pedidos pendientes.</p>}

          {expandedOrderId && orderDetails[expandedOrderId] ? (
            <div className="card" style={{ margin: '1rem 0' }}>
              <h4>Detalle del pedido #{expandedOrderId}</h4>
              {orderDetails[expandedOrderId].order?.delivery_method === 'national' ? (
                <div className="shipping-summary">
                  <h5>Datos de envío nacional</h5>
                  <p><strong>Nombre:</strong> {orderDetails[expandedOrderId].order.shipping_details?.name}</p>
                  <p><strong>Teléfono:</strong> {orderDetails[expandedOrderId].order.shipping_details?.phone}</p>
                  <p><strong>Cédula:</strong> {orderDetails[expandedOrderId].order.shipping_details?.cedula}</p>
                  <p><strong>Agencia:</strong> {orderDetails[expandedOrderId].order.shipping_details?.agency}</p>
                  <p><strong>Destino:</strong> {orderDetails[expandedOrderId].order.shipping_details?.city}, {orderDetails[expandedOrderId].order.shipping_details?.state}</p>
                </div>
              ) : <p className="delivery-summary">Entrega personal en San Cristóbal</p>}
              {orderDetails[expandedOrderId].order?.payment_proof_url ? (
                <div style={{ marginBottom: '1rem' }}>
                  <h5 style={{ marginBottom: '0.5rem' }}>Comprobante adjunto</h5>
                  <a href={getProofUrl(orderDetails[expandedOrderId].order.payment_proof_url)} target="_blank" rel="noreferrer">
                    <img src={getProofUrl(orderDetails[expandedOrderId].order.payment_proof_url)} alt="Comprobante del pedido" style={{ width: '180px', height: '180px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                  </a>
                </div>
              ) : null}
              <ul className="dashboard-list">
                {orderDetails[expandedOrderId].items?.map((item) => (
                  <li key={item.id}>
                    <span>{item.product_title || `Producto #${item.product_id}`} · Talla {item.size || 'No indicada'} · {item.no_dorsal ? 'Sin dorsal' : item.custom_name ? `Personalizada: ${item.custom_name} #${item.custom_number}` : item.dorsal_number ? `Dorsal ${item.dorsal_number}${item.dorsal_name ? ` (${item.dorsal_name})` : ''}` : 'Sin dorsal'} · {item.quantity} und.</span>
                    <strong>{formatCurrency(Number(item.unit_price || 0) * Number(item.quantity || 1), 'USD')}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 style={{ marginTop: '1.25rem' }}>Pedidos procesados</h3>
          {processedOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Comprobante</th>
                  <th>Detalle</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {processedOrders.map((order) => (
                  <tr key={order.id}>
                    <td>#{order.id}</td>
                    <td>{order.client?.name}</td>
                    <td>
                      <div>{formatCurrency(order.total_amount, 'USD')}</div>
                      <div className="price-bs">{formatCurrency(Number(order.total_amount) * exchangeRate, 'BS')}</div>
                    </td>
                    <td>
                      {order.payment_proof_url ? (
                        <a href={getProofUrl(order.payment_proof_url)} target="_blank" rel="noreferrer" title="Ver comprobante" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '999px', background: '#eff6ff', color: '#2563eb', textDecoration: 'none' }}>
                          👁️
                        </a>
                      ) : <span className="badge">Sin comprobante</span>}
                    </td>
                    <td>
                      <button className="ghost-btn" onClick={() => loadOrderDetail(order.id)}>{expandedOrderId === order.id ? 'Ocultar' : 'Ver productos'}</button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {order.status === 'approved' ? <span className="badge">Aprobado</span> : <span className="badge">Rechazado</span>}
                        <button className="ghost-btn" onClick={() => downloadInvoice(order.id)}>Factura</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#64748b' }}>Todavía no hay pedidos aprobados o rechazados.</p>}
        </div>
      ) : null}

      {activeView === 'audit' ? (
        <div className="card">
          <h3>Auditoría</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Detalles</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.user?.name || 'Sistema'}</td>
                  <td>{log.action}</td>
                  <td>{log.table_name}</td>
                  <td><button className="ghost-btn" onClick={() => setActiveLog(log)}>Ver JSON</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeLog ? (
        <div className="modal-backdrop" onClick={() => setActiveLog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Detalle del cambio</h3>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(activeLog.changes, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminPage;
