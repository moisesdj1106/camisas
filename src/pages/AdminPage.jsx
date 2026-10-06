import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, apiUrl, assetUrl } from '../api';
import Modal from '../components/Modal';

const formatCurrency = (value, currency = 'USD') => {
  const amount = Number(value || 0);
  return currency === 'BS'
    ? `BS ${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`
    : `$${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
};

const toLocalDateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const isDateInRange = (value, dateRange) => {
  if (!dateRange) return true;
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const localDate = toLocalDateInput(date);
  return (!dateRange.from || localDate >= dateRange.from) && (!dateRange.to || localDate <= dateRange.to);
};

const parseLocalizedAmount = (value) => {
  const raw = String(value ?? '').trim().replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!raw || !/\d/.test(raw) || /[.,]$/.test(raw)) return Number.NaN;
  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/-/g, '');
  const lastDot = unsigned.lastIndexOf('.');
  const lastComma = unsigned.lastIndexOf(',');
  let decimalSeparator = '';
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? '.' : ',';
  } else {
    const separator = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    if (separator) {
      const separatorCount = unsigned.split(separator).length - 1;
      const trailingDigits = unsigned.length - unsigned.lastIndexOf(separator) - 1;
      if (trailingDigits > 0 && trailingDigits <= 2) decimalSeparator = separator;
      else if (separatorCount === 1 && trailingDigits === 0) return Number.NaN;
    }
  }
  let normalized = unsigned;
  if (decimalSeparator) {
    const decimalIndex = unsigned.lastIndexOf(decimalSeparator);
    const integerPart = unsigned.slice(0, decimalIndex).replace(/[.,]/g, '') || '0';
    const fractionPart = unsigned.slice(decimalIndex + 1).replace(/[.,]/g, '');
    normalized = `${integerPart}.${fractionPart}`;
  } else {
    normalized = unsigned.replace(/[.,]/g, '');
  }
  return Number(`${negative ? '-' : ''}${normalized}`);
};

const formatAmountInput = (value) => Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const getPaymentMethodCurrency = (method) => {
  const normalizedMethod = String(method || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return normalizedMethod === 'pagomovil' ? 'BS' : 'USD';
};

const getOrderCurrency = (order) => {
  const firstPaymentCurrency = String(order?.first_payment_currency || '').toUpperCase();
  return ['USD', 'BS'].includes(firstPaymentCurrency) ? firstPaymentCurrency : getPaymentMethodCurrency(order?.payment_method);
};
const confirmedPaymentStatuses = new Set(['approved', 'preparing', 'ready_pickup', 'shipped', 'delivered']);

const convertAmountCurrency = (value, fromCurrency, toCurrency, rate) => {
  const amount = parseLocalizedAmount(value);
  const exchangeRate = Number(rate || 0);
  if (!Number.isFinite(amount) || amount < 0 || exchangeRate <= 0 || fromCurrency === toCurrency) return value;
  return formatAmountInput(fromCurrency === 'BS' ? amount / exchangeRate : amount * exchangeRate);
};

const changePaymentMethod = (current, paymentMethod, rate) => {
  const fromCurrency = getPaymentMethodCurrency(current.payment_method);
  const toCurrency = getPaymentMethodCurrency(paymentMethod);
  const deliveryCurrency = current.delivery_payment_currency || fromCurrency;
  const followsPaymentMethod = deliveryCurrency === fromCurrency;
  return {
    ...current,
    payment_method: paymentMethod,
    full_payment_amount: convertAmountCurrency(current.full_payment_amount, fromCurrency, toCurrency, rate),
    delivery_payment_currency: followsPaymentMethod ? toCurrency : deliveryCurrency,
    delivery_payment_amount: followsPaymentMethod ? convertAmountCurrency(current.delivery_payment_amount, deliveryCurrency, toCurrency, rate) : current.delivery_payment_amount
  };
};

const changeFirstPaymentCurrency = (current, currency, rate) => ({
  ...current,
  first_payment_currency: currency,
  first_payment_amount: convertAmountCurrency(current.first_payment_amount, current.first_payment_currency, currency, rate)
});

const changeDeliveryPaymentCurrency = (current, currency, rate) => ({
  ...current,
  delivery_payment_currency: currency,
  delivery_payment_amount: convertAmountCurrency(current.delivery_payment_amount, current.delivery_payment_currency, currency, rate)
});

const getInstallmentSummary = (order) => {
  const rate = Number(order.exchange_rate || 0);
  const amount = Number(order.first_payment_amount || 0);
  const currency = getOrderCurrency(order);
  const paidUsd = currency === 'BS' ? (rate > 0 ? amount / rate : null) : amount;
  const hasFirstProof = Boolean(order.payment_proof_url);
  const hasFinalProof = Boolean(order.delivery_payment_proof_url);
  const finalAmount = Number(order.delivery_payment_amount || 0);
  const finalCurrency = order.delivery_payment_currency || getPaymentMethodCurrency(order.payment_method);
  const finalPaidUsd = finalCurrency === 'BS' ? (rate > 0 ? finalAmount / rate : null) : finalAmount;
  const balanceBeforeFinal = paidUsd === null ? null : Math.max(0, Number(order.total_amount || 0) - paidUsd);
  const effectiveFinalPaidUsd = finalPaidUsd > 0 ? finalPaidUsd : hasFinalProof ? balanceBeforeFinal : 0;
  const remainingUsd = balanceBeforeFinal === null ? null : Math.max(0, balanceBeforeFinal - effectiveFinalPaidUsd);
  const isComplete = hasFirstProof && hasFinalProof && remainingUsd !== null && remainingUsd < 0.01;
  return { amount, currency, finalAmount, finalCurrency, paidUsd, remainingUsd, remainingBs: remainingUsd === null || rate <= 0 ? null : remainingUsd * rate, hasFirstProof, hasFinalProof, isComplete, rate };
};

const getPaymentLedger = (orders, fallbackRate, dateRange = null) => {
  const totals = {
    USD: { expected: 0, first: 0, other: 0, received: 0, pending: 0 },
    BS: { expected: 0, first: 0, other: 0, received: 0, pending: 0 }
  };
  const excludedStatuses = new Set(['rejected', 'cancelled']);

  orders.forEach((order) => {
    if (excludedStatuses.has(order.status)) return;
    const storedRate = Number(order.exchange_rate);
    const rate = Number.isFinite(storedRate) && storedRate > 0
      ? storedRate
      : Number(fallbackRate) > 0 ? Number(fallbackRate) : 0;
    if (rate <= 0) return;

    const totalUsd = Number(order.total_amount || 0);
    const isConfirmed = confirmedPaymentStatuses.has(order.status);
    const orderInDateRange = isDateInRange(order.created_at, dateRange);
    const firstPaymentInDateRange = isDateInRange(order.payment_received_at || order.created_at, dateRange);
    const finalPaymentInDateRange = isDateInRange(order.delivery_payment_received_at || order.created_at, dateRange);

    let firstUsd = 0;
    let otherUsd = 0;

    if (isConfirmed && order.payment_plan === 'installments') {
      const firstAmount = Number(order.first_payment_amount || 0);
      const firstCurrency = String(order.first_payment_currency || '').toUpperCase() === 'BS' ? 'BS' : 'USD';
      if (firstCurrency === 'BS') {
        firstUsd = firstAmount / rate;
      } else {
        firstUsd = firstAmount;
      }

      const finalAmount = Number(order.delivery_payment_amount || 0);
      const finalCurrency = order.delivery_payment_currency || getPaymentMethodCurrency(order.payment_method);
      if (finalCurrency === 'BS') {
        otherUsd = (finalAmount > 0 ? finalAmount : (order.delivery_payment_proof_url ? Math.max(0, totalUsd - firstUsd) * rate : 0)) / rate;
      } else {
        otherUsd = finalAmount > 0 ? finalAmount : (order.delivery_payment_proof_url ? Math.max(0, totalUsd - firstUsd) : 0);
      }
    } else if (isConfirmed && order.payment_plan !== 'installments') {
      const fullAmount = Number(order.full_payment_amount || 0);
      const methodCurrency = getPaymentMethodCurrency(order.payment_method);
      if (methodCurrency === 'BS') {
        otherUsd = (fullAmount > 0 ? fullAmount : totalUsd * rate) / rate;
      } else {
        otherUsd = fullAmount > 0 ? fullAmount : totalUsd;
      }
    }

    const receivedFirstUsd = Math.min(totalUsd, Math.max(0, firstUsd));
    const receivedOtherUsd = Math.min(Math.max(0, totalUsd - receivedFirstUsd), Math.max(0, otherUsd));
    const receivedUsd = receivedFirstUsd + receivedOtherUsd;
    const pendingUsd = Math.max(0, totalUsd - receivedUsd);
    const firstCurrency = String(order.first_payment_currency || '').toUpperCase() === 'BS' ? 'BS' : 'USD';
    const finalCurrency = order.delivery_payment_currency || getPaymentMethodCurrency(order.payment_method);
    const firstReceivedBs = firstCurrency === 'BS' ? receivedFirstUsd * rate : 0;
    const firstReceivedUsd = firstCurrency === 'USD' ? receivedFirstUsd : 0;
    const otherReceivedBs = finalCurrency === 'BS' ? receivedOtherUsd * rate : 0;
    const otherReceivedUsd = finalCurrency === 'USD' ? receivedOtherUsd : 0;

    if (orderInDateRange) {
      totals.USD.expected += totalUsd;
      totals.BS.expected += totalUsd * rate;
      totals.USD.pending += pendingUsd;
      totals.BS.pending += pendingUsd * rate;
    }
    if (firstPaymentInDateRange) {
      totals.USD.first += firstReceivedUsd;
      totals.BS.first += firstReceivedBs;
      totals.USD.received += firstReceivedUsd;
      totals.BS.received += firstReceivedBs;
    }
    if (finalPaymentInDateRange) {
      totals.USD.other += otherReceivedUsd;
      totals.BS.other += otherReceivedBs;
      totals.USD.received += otherReceivedUsd;
      totals.BS.received += otherReceivedBs;
    }
  });

  return totals;
};

const normalizeSearchText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const productTypeLabels = {
  local: 'Local',
  visitante: 'Visitante',
  tercera: 'Alterna'
};

const sizeOptions = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const ADMIN_ITEMS_PER_PAGE = 8;
const emptyStockBySize = () => Object.fromEntries(sizeOptions.map((size) => [size, '']));

const createEmptyForm = () => ({
  title: '',
  description: '',
  price: '',
  discount_percent: '0',
  stock: '',
  stock_by_size: emptyStockBySize(),
  club_id: '',
  type: 'local',
  image_url: '',
  image_urls: '',
  dorsal_options: '',
  allow_no_dorsal: true,
  allow_catalog_dorsal: true,
  allow_custom_dorsal: true,
  is_active: true
});

const createEmptyClubForm = () => ({
  name: '',
  country: '',
  logo_url: '',
  category: 'club'
});

const createEmptyManualOrderForm = () => ({
  client: { name: '', email: '', phone: '' },
  items: [],
  payment_method: 'pago_movil',
  payment_plan: 'full',
  first_payment_amount: '',
  first_payment_currency: 'USD',
  full_payment_amount: '',
  delivery_payment_amount: '',
  delivery_payment_currency: 'BS',
  first_payment_proof: null,
  delivery_payment_proof: null,
  delivery_method: 'personal',
  status: 'pending',
  shipping_details: { name: '', phone: '', cedula: '', agency: '', city: '', state: '' }
});

const AdminPagination = ({ page, totalItems, onPageChange, label }) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / ADMIN_ITEMS_PER_PAGE));
  if (totalItems <= ADMIN_ITEMS_PER_PAGE) return null;
  return (
    <div className="orders-pagination" aria-label={`Paginación de ${label}`}>
      <button className="ghost-btn" type="button" disabled={page === 1} onClick={() => onPageChange((current) => Math.max(1, current - 1))}>Anterior</button>
      <span>{(page - 1) * ADMIN_ITEMS_PER_PAGE + 1}-{Math.min(page * ADMIN_ITEMS_PER_PAGE, totalItems)} de {totalItems}</span>
      <button className="ghost-btn" type="button" disabled={page === totalPages} onClick={() => onPageChange((current) => Math.min(totalPages, current + 1))}>Siguiente</button>
    </div>
  );
};

const createEmptyContentForm = () => ({
  type: 'banner',
  slot: 'banner',
  placement: 'banner',
  media_url: '',
  title: '',
  description: '',
  link_url: '',
  sort_order: 0,
  is_active: true
});

const createEmptyStockRequestForm = () => ({
  client_name: '',
  phone: '',
  email: '',
  model: '',
  shirt_type: 'local',
  size_quantities: Object.fromEntries(sizeOptions.map((size) => [size, ''])),
  has_print: false,
  printed_details: [],
  deposit_amount: '',
  deposit_currency: 'USD',
  notes: '',
  model_image: null,
  image_url: '',
  remove_image: false
});

const orderStatusOptions = [
  ['pending', 'Pendiente'],
  ['approved', 'Aprobado'],
  ['rejected', 'Rechazado']
];

const ORDERS_PER_PAGE = 8;
const USERS_PER_PAGE = 8;

const AdminPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeLog, setActiveLog] = useState(null);
  const [activeView, setActiveView] = useState(new URLSearchParams(location.search).get('view') || 'overview');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
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
  const [orderItemsPage, setOrderItemsPage] = useState(1);
  const [orderDetails, setOrderDetails] = useState({});
  const [orderItemForm, setOrderItemForm] = useState({ product_id: '', size: '', quantity: 1, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' });
  const [orderItemDorsals, setOrderItemDorsals] = useState([]);
  const [editingOrderItems, setEditingOrderItems] = useState(false);
  const [editingOrderItemId, setEditingOrderItemId] = useState(null);
  const [closurePeriod, setClosurePeriod] = useState('day');
  const [closureDate, setClosureDate] = useState(toLocalDateInput(new Date()));
  const [closureSummary, setClosureSummary] = useState(null);
  const [dailyClosureOpen, setDailyClosureOpen] = useState(null);
  const [closurePage, setClosurePage] = useState(1);
  const [isClosing, setIsClosing] = useState(false);
  const [isResettingMetrics, setIsResettingMetrics] = useState(false);
  const [orderFilter, setOrderFilter] = useState('all');
  const [installmentFilter, setInstallmentFilter] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [inventorySearch, setInventorySearch] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [clubsPage, setClubsPage] = useState(1);
  const [contentPage, setContentPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [clubCategoryFilter, setClubCategoryFilter] = useState('all');
  const [editingUserId, setEditingUserId] = useState(null);
  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', phone: '', password: '', role: 'client' });
  const [confirmation, setConfirmation] = useState(null);
  const [content, setContent] = useState([]);
  const [contentForm, setContentForm] = useState(createEmptyContentForm());
  const [editingContentId, setEditingContentId] = useState(null);
  const [isUploadingContent, setIsUploadingContent] = useState(false);
  const [isUploadingProductImages, setIsUploadingProductImages] = useState(false);
  const [allDiscountDraft, setAllDiscountDraft] = useState('10');
  const [orderDiscountEdit, setOrderDiscountEdit] = useState(null);
  const [orderEdit, setOrderEdit] = useState(null);
  const [manualOrderForm, setManualOrderForm] = useState(createEmptyManualOrderForm());
  const [manualOrderItemForm, setManualOrderItemForm] = useState({ product_id: '', size: '', quantity: 1, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' });
  const [manualOrderDorsals, setManualOrderDorsals] = useState([]);
  const [manualOrderOpen, setManualOrderOpen] = useState(false);
  const [manualOrderStep, setManualOrderStep] = useState(1);
  const [manualOrderError, setManualOrderError] = useState('');
  const [uploadingOrderProof, setUploadingOrderProof] = useState('');
  const [ledgerDate, setLedgerDate] = useState('');
  const [ledgerDateFrom, setLedgerDateFrom] = useState('');
  const [ledgerDateTo, setLedgerDateTo] = useState('');
  const [cashWithdrawals, setCashWithdrawals] = useState([]);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalConcept, setWithdrawalConcept] = useState('');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [withdrawalFormOpen, setWithdrawalFormOpen] = useState(false);
  const [withdrawalHistoryOpen, setWithdrawalHistoryOpen] = useState(false);
  const [isSavingWithdrawal, setIsSavingWithdrawal] = useState(false);
  const today = toLocalDateInput(new Date());
  const oldestLedgerDateValue = new Date();
  oldestLedgerDateValue.setFullYear(oldestLedgerDateValue.getFullYear() - 300);
  const oldestLedgerDate = toLocalDateInput(oldestLedgerDateValue);
  const [approvedPdfFrom, setApprovedPdfFrom] = useState(today);
  const [approvedPdfTo, setApprovedPdfTo] = useState(today);
  const [stockRequests, setStockRequests] = useState([]);
  const [stockRequestForm, setStockRequestForm] = useState(createEmptyStockRequestForm());
  const [stockRequestModalOpen, setStockRequestModalOpen] = useState(false);
  const [editingStockRequestId, setEditingStockRequestId] = useState(null);
  const [stockRequestPreview, setStockRequestPreview] = useState('');
  const [stockRequestFrom, setStockRequestFrom] = useState('');
  const [stockRequestTo, setStockRequestTo] = useState('');
  const [stockRequestError, setStockRequestError] = useState('');
  const [isLoadingStockRequests, setIsLoadingStockRequests] = useState(false);
  const [isSavingStockRequest, setIsSavingStockRequest] = useState(false);
  const [isDownloadingStockRequests, setIsDownloadingStockRequests] = useState(false);
  const [isDownloadingInventoryPdf, setIsDownloadingInventoryPdf] = useState(false);
  const stockRequestLoadId = useRef(0);
  const productFormRef = useRef(null);

  const parseImageUrls = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  };

  useEffect(() => {
    const nextView = new URLSearchParams(location.search).get('view') || 'overview';
    setActiveView(nextView);
  }, [location.search]);

  useEffect(() => {
    setOrderItemsPage(1);
  }, [expandedOrderId]);

  useEffect(() => {
    if (editingProductId && showCreateForm) {
      window.requestAnimationFrame(() => productFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [editingProductId, showCreateForm]);

  useEffect(() => {
    if (!stockRequestPreview) return undefined;
    return () => URL.revokeObjectURL(stockRequestPreview);
  }, [stockRequestPreview]);

  const loadDashboard = async () => {
    const token = localStorage.getItem('token');
    try {
      const [dashRes, ordersRes, auditsRes, inventoryRes, clubsRes, rateRes, usersRes, contentRes] = await Promise.allSettled([
        fetch(apiUrl('/api/admin/dashboard'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/orders'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/audit-logs'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/products'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/clubs'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/exchange-rate'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/users'), { headers: { Authorization: `Bearer ${token}` } }),
        fetch(apiUrl('/api/admin/content'), { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const readResponse = async (result, fallback) => result.status === 'fulfilled' ? result.value.json().catch(() => fallback) : fallback;
      const dashboardData = await readResponse(dashRes, null);
      const ordersData = await readResponse(ordersRes, []);
      const auditLogsData = await readResponse(auditsRes, []);
      const inventoryData = await readResponse(inventoryRes, []);
      const clubsData = await readResponse(clubsRes, []);
      const rateData = await readResponse(rateRes, { exchangeRate: 36 });
      const usersData = await readResponse(usersRes, []);
      const contentData = await readResponse(contentRes, []);
      setDashboard(dashboardData);
      setOrders(Array.isArray(ordersData) ? ordersData : []);
      setAuditLogs(Array.isArray(auditLogsData) ? auditLogsData : []);
      setInventory(Array.isArray(inventoryData) ? inventoryData : []);
      setClubs(Array.isArray(clubsData) ? clubsData : []);
      setExchangeRate(Number(rateData.exchangeRate || 36));
      setExchangeRateDraft(String(rateData.exchangeRate || 36));
      setUsers(Array.isArray(usersData) ? usersData : []);
      setContent(Array.isArray(contentData) ? contentData : []);
    } catch (error) {
      setMessage('No se pudo cargar la información del panel.');
    }
  };

  const loadCashWithdrawals = async () => {
    try {
      const response = await apiFetch('/api/admin/cash-withdrawals', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los retiros.');
      setCashWithdrawals(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error.message || 'No se pudieron cargar los retiros.');
    }
  };

  const loadStockRequests = async () => {
    const loadId = ++stockRequestLoadId.current;
    setIsLoadingStockRequests(true);
    setStockRequestError('');
    try {
      const query = new URLSearchParams();
      if (stockRequestFrom) query.set('from', stockRequestFrom);
      if (stockRequestTo) query.set('to', stockRequestTo);
      const queryString = query.toString();
      const response = await fetch(apiUrl(`/api/admin/stock-requests${queryString ? `?${queryString}` : ''}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || (response.status === 404
        ? 'La ruta de apartados no existe en el backend activo. Reinicia o vuelve a desplegar el backend actualizado.'
        : 'No se pudieron cargar las solicitudes.'));
      if (loadId === stockRequestLoadId.current) setStockRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      if (loadId === stockRequestLoadId.current) setStockRequestError(error.message || 'No se pudieron cargar las solicitudes.');
    } finally {
      if (loadId === stockRequestLoadId.current) setIsLoadingStockRequests(false);
    }
  };

  useEffect(() => {
    if (activeView === 'stock-requests') loadStockRequests();
  }, [activeView, stockRequestFrom, stockRequestTo]);

  useEffect(() => {
    loadDashboard();
    loadCashWithdrawals();
    const refreshTimer = window.setInterval(() => {
      loadDashboard();
      loadCashWithdrawals();
    }, 15000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const saveContent = async (event) => {
    event.preventDefault();
    const placementOrder = { 'video-left': 0, 'video-right': 1, 'video-horizontal': 2 };
    const isVideoPlacement = contentForm.placement?.startsWith('video-');
    const payload = {
      ...contentForm,
      slot: isVideoPlacement ? 'video' : contentForm.placement,
      type: isVideoPlacement ? 'video' : contentForm.placement === 'gallery' ? 'image' : 'banner',
      sort_order: isVideoPlacement ? placementOrder[contentForm.placement] : Number(contentForm.sort_order) || 0
    };
    const response = await fetch(apiUrl(editingContentId ? `/api/admin/content/${editingContentId}` : '/api/admin/content'), {
      method: editingContentId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return setMessage('No se pudo guardar el contenido.');
    setMessage(editingContentId ? 'Contenido actualizado' : 'Contenido publicado');
    setContentForm(createEmptyContentForm());
    setEditingContentId(null);
    loadDashboard();
  };

  const uploadContentFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploadingContent(true);
    if (file.type.startsWith('video/')) {
      setContentForm((current) => ({ ...current, type: 'video', slot: 'video', placement: current.placement?.startsWith('video-') ? current.placement : 'video-left', sort_order: current.placement === 'video-right' ? 1 : current.placement === 'video-horizontal' ? 2 : 0 }));
    }
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch(apiUrl('/api/admin/content/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setContentForm((current) => ({ ...current, media_url: assetUrl(data.media_url || '') }));
      else setMessage(data.error || 'No se pudo subir el archivo.');
    } finally {
      setIsUploadingContent(false);
      event.target.value = '';
    }
  };

  const editContent = (item) => {
    setEditingContentId(item.id);
    const placement = item.slot === 'video'
      ? Number(item.sort_order) === 0 ? 'video-left' : Number(item.sort_order) === 1 ? 'video-right' : 'video-horizontal'
      : item.slot || (item.type === 'banner' ? 'banner' : 'gallery');
    setContentForm({ type: item.type, slot: item.slot || 'gallery', placement, media_url: item.media_url, title: item.title || '', description: item.description || '', link_url: item.link_url || '', sort_order: item.sort_order || 0, is_active: item.is_active !== false });
  };

  const removeContent = async (id) => {
    const response = await fetch(apiUrl(`/api/admin/content/${id}`), { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    if (response.ok) setContent((current) => current.filter((item) => item.id !== id));
  };

  const uploadProductImages = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setIsUploadingProductImages(true);
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    try {
      const response = await fetch(apiUrl('/api/admin/products/upload-images'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || 'No se pudieron subir las imágenes.');
        return;
      }
      const uploadedUrls = Array.isArray(data.image_urls) ? data.image_urls : [];
      const currentUrls = parseImageUrls(form.image_urls);
      setForm((current) => ({
        ...current,
        image_url: current.image_url || uploadedUrls[0] || '',
        image_urls: [...currentUrls, ...uploadedUrls].join(', ')
      }));
      setMessage(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`);
    } catch (error) {
      setMessage('No se pudieron subir las imágenes.');
    } finally {
      setIsUploadingProductImages(false);
      event.target.value = '';
    }
  };

  const uploadAdminOrderProof = async (event, formName, fieldName) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const uploadKey = `${formName}:${fieldName}`;
    setUploadingOrderProof(uploadKey);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch(apiUrl('/api/admin/orders/upload-proof'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.proof_url) throw new Error(data.error || 'Cloudinary no devolvió el enlace del comprobante.');
      if (formName === 'manual') {
        setManualOrderForm((current) => ({ ...current, [fieldName]: data.proof_url }));
        setManualOrderError('');
      } else {
        setOrderEdit((current) => current ? { ...current, [fieldName]: data.proof_url } : current);
      }
      setMessage('Comprobante subido a Cloudinary. Enlace listo para guardar.');
    } catch (error) {
      if (formName === 'manual') setManualOrderError(error.message || 'No se pudo subir el comprobante.');
      else setMessage(error.message || 'No se pudo subir el comprobante.');
    } finally {
      setUploadingOrderProof('');
      input.value = '';
    }
  };

  const saveOrderDiscount = async () => {
    const discount = Number(orderDiscountEdit?.discount);
    if (!orderDiscountEdit || !Number.isFinite(discount) || discount < 0 || discount > 100) {
      setMessage('El descuento del pedido debe estar entre 0 y 100.');
      return;
    }
    const response = await fetch(apiUrl(`/api/admin/orders/${orderDiscountEdit.id}/discount`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ discount_percent: discount })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo aplicar el descuento al pedido.');
      return;
    }
    setOrders((current) => current.map((order) => order.id === data.id ? { ...order, total_amount: data.total_amount, subtotal_amount: data.subtotal_amount, discount_percent: data.discount_percent } : order));
    setOrderDetails((current) => current[data.id] ? { ...current, [data.id]: { ...current[data.id], order: { ...current[data.id].order, ...data } } } : current);
    setOrderDiscountEdit(null);
    setMessage(discount ? `Descuento del ${discount}% aplicado al pedido #${data.id}.` : `Descuento retirado del pedido #${data.id}.`);
  };

  const openOrderEdit = async (orderId) => {
    let detail = orderDetails[orderId];
    if (!detail) {
      const response = await fetch(apiUrl(`/api/orders/${orderId}`), { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      detail = await response.json().catch(() => null);
    }
    if (!detail?.order) {
      setMessage('No se pudo cargar el pedido para editarlo.');
      return;
    }
    setOrderDetails((current) => ({ ...current, [orderId]: detail }));
    const rate = Number(detail.order.exchange_rate || exchangeRate);
    const paymentCurrency = getPaymentMethodCurrency(detail.order.payment_method);
    const firstPaymentCurrency = String(detail.order.first_payment_currency || paymentCurrency).toUpperCase();
    setOrderEdit({
      id: orderId,
      payment_method: detail.order.payment_method || 'pago_movil',
      payment_plan: detail.order.payment_plan || 'full',
      first_payment_amount: Number(detail.order.first_payment_amount || 0) > 0 ? formatAmountInput(detail.order.first_payment_amount) : '',
      first_payment_currency: firstPaymentCurrency,
      full_payment_amount: Number(detail.order.full_payment_amount || 0) > 0
        ? formatAmountInput(detail.order.full_payment_amount)
        : confirmedPaymentStatuses.has(detail.order.status) && detail.order.payment_plan !== 'installments'
          ? formatAmountInput(Number(detail.order.total_amount) * (paymentCurrency === 'BS' ? rate : 1))
          : '',
      delivery_payment_amount: Number(detail.order.delivery_payment_amount || 0) > 0 ? formatAmountInput(detail.order.delivery_payment_amount) : '',
      delivery_payment_currency: detail.order.delivery_payment_currency || paymentCurrency,
      exchange_rate: rate,
      payment_proof_url: detail.order.payment_proof_url || '',
      delivery_payment_proof_url: detail.order.delivery_payment_proof_url || '',
      delivery_method: detail.order.delivery_method || 'personal',
      status: detail.order.status || 'pending',
      shipping_details: { name: '', phone: '', cedula: '', agency: '', city: '', state: '', ...(detail.order.shipping_details || {}) }
    });
  };

  const saveOrderEdit = async () => {
    if (!orderEdit) return;
    if (uploadingOrderProof.startsWith('edit:')) {
      setMessage('Espera a que termine la subida del comprobante.');
      return;
    }
    const parsedFirstPaymentAmount = parseLocalizedAmount(orderEdit.first_payment_amount);
    const parsedFullPaymentAmount = parseLocalizedAmount(orderEdit.full_payment_amount);
    const parsedDeliveryPaymentAmount = parseLocalizedAmount(orderEdit.delivery_payment_amount);
    if (orderEdit.payment_plan === 'installments' && (!Number.isFinite(parsedFirstPaymentAmount) || parsedFirstPaymentAmount <= 0)) {
      setMessage('Indica el monto del primer abono.');
      return;
    }
    const storedOrder = orderDetails[orderEdit.id]?.order;
    const unchangedLegacyFinalProof = Boolean(storedOrder?.delivery_payment_proof_url && !Number(storedOrder.delivery_payment_amount) && storedOrder.delivery_payment_proof_url === orderEdit.delivery_payment_proof_url);
    if (orderEdit.payment_plan === 'installments' && orderEdit.delivery_payment_proof_url && (!Number.isFinite(parsedDeliveryPaymentAmount) || parsedDeliveryPaymentAmount <= 0) && !unchangedLegacyFinalProof) {
      setMessage('Indica el monto recibido en el pago final.');
      return;
    }
    if (orderEdit.payment_plan === 'full' && confirmedPaymentStatuses.has(orderEdit.status) && (!Number.isFinite(parsedFullPaymentAmount) || parsedFullPaymentAmount <= 0)) {
      setMessage('Indica el monto recibido por el pago completo.');
      return;
    }
    const formData = new FormData();
    formData.append('payment_method', orderEdit.payment_method);
    formData.append('payment_plan', orderEdit.payment_plan);
    formData.append('first_payment_amount', orderEdit.payment_plan === 'installments' ? parsedFirstPaymentAmount.toFixed(2) : '0');
    formData.append('first_payment_currency', orderEdit.first_payment_currency);
    formData.append('full_payment_amount', orderEdit.payment_plan === 'full' && Number.isFinite(parsedFullPaymentAmount) ? parsedFullPaymentAmount.toFixed(2) : '0');
    formData.append('delivery_payment_amount', orderEdit.payment_plan === 'installments' && Number.isFinite(parsedDeliveryPaymentAmount) ? parsedDeliveryPaymentAmount.toFixed(2) : '0');
    formData.append('delivery_payment_currency', orderEdit.delivery_payment_currency);
    formData.append('payment_proof_url', orderEdit.payment_proof_url || '');
    formData.append('delivery_payment_proof_url', orderEdit.delivery_payment_proof_url || '');
    formData.append('delivery_method', orderEdit.delivery_method);
    formData.append('status', orderEdit.status);
    formData.append('shipping_details', JSON.stringify(orderEdit.shipping_details));
    const response = await fetch(apiUrl(`/api/admin/orders/${orderEdit.id}`), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo actualizar el pedido.');
      return;
    }
    setOrders((current) => current.map((order) => order.id === data.id ? { ...order, ...data } : order));
    setOrderDetails((current) => current[data.id] ? { ...current, [data.id]: { ...current[data.id], order: { ...current[data.id].order, ...data } } } : current);
    setOrderEdit(null);
    setMessage(`Pedido #${data.id} actualizado correctamente.`);
  };

  const deleteSelectedOrders = async () => {
    const response = await apiFetch('/api/admin/orders/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ orderIds: selectedOrderIds })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudieron eliminar los pedidos.');
      return;
    }
    const deletedIds = new Set(data.ids || selectedOrderIds);
    setOrders((current) => current.filter((order) => !deletedIds.has(order.id)));
    setSelectedOrderIds([]);
    setOrderPage(1);
    setOrderDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.has(Number(id)))));
    setExpandedOrderId(null);
    setMessage(`${deletedIds.size} pedido(s) eliminado(s).`);
  };

  const deleteOrder = async (orderId) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/orders/${orderId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || 'No se pudo eliminar el pedido.');
        return;
      }
      setOrders((current) => current.filter((order) => order.id !== orderId));
      setOrderPage(1);
      setOrderDetails((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      setExpandedOrderId(null);
      setMessage(`Pedido #${orderId} eliminado.`);
    } catch (error) {
      setMessage('No se pudo eliminar el pedido.');
    }
  };

  const startEditUser = (user) => {
    setEditingUserId(user.id);
    setShowCreateUserForm(false);
    setUserForm({ name: user.name || '', email: user.email || '', phone: user.phone || '', password: '', role: user.role || 'client' });
  };

  const startCreateUser = () => {
    setEditingUserId(null);
    setUserForm({ name: '', email: '', phone: '', password: '', role: 'client' });
    setShowCreateUserForm(true);
  };

  const saveUser = async (event) => {
    event.preventDefault();
    const isCreating = showCreateUserForm;
    const response = await fetch(apiUrl(isCreating ? '/api/admin/users' : `/api/admin/users/${editingUserId}`), {
      method: isCreating ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(userForm)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo actualizar el usuario.');
      return;
    }
    if (isCreating) setUsers((current) => [data, ...current]);
    else setUsers((current) => current.map((user) => user.id === data.id ? { ...user, ...data } : user));
    setEditingUserId(null);
    setShowCreateUserForm(false);
    setUserForm({ name: '', email: '', phone: '', password: '', role: 'client' });
    setMessage(isCreating ? 'Usuario creado.' : 'Usuario actualizado.');
  };

  const deleteUser = async (user) => {
    const response = await fetch(apiUrl(`/api/admin/users/${user.id}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo eliminar el usuario.');
      return;
    }
    setUsers((current) => current.filter((item) => item.id !== user.id));
    setUserPage(1);
    setMessage('Usuario eliminado.');
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
        discount_percent: Number(form.discount_percent) || 0,
        stock: Number(form.stock),
        stock_by_size: Object.fromEntries(sizeOptions.map((size) => [size, Number(form.stock_by_size[size]) || 0])),
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
      discount_percent: detailedProduct.discount_percent ?? 0,
      stock: detailedProduct.stock ?? '',
      stock_by_size: { ...emptyStockBySize(), ...(detailedProduct.stock_by_size || {}) },
      club_id: detailedProduct.club_id ?? '1',
      type: detailedProduct.type || 'local',
      image_url: detailedProduct.image_url || '',
      image_urls: Array.isArray(detailedProduct.image_urls) ? detailedProduct.image_urls.join(', ') : '',
      dorsal_options: Array.isArray(detailedProduct.dorsals) ? detailedProduct.dorsals.map((item) => item.dorsal_number).join(', ') : '',
      allow_no_dorsal: detailedProduct.allow_no_dorsal !== false,
      allow_catalog_dorsal: detailedProduct.allow_catalog_dorsal !== false,
      allow_custom_dorsal: detailedProduct.allow_custom_dorsal !== false,
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
        discount_percent: Number(form.discount_percent) || 0,
        stock: Number(form.stock),
        stock_by_size: Object.fromEntries(sizeOptions.map((size) => [size, Number(form.stock_by_size[size]) || 0])),
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

  const applyDiscountToAll = async (discountPercent) => {
    const discount = Number(discountPercent);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      setMessage('El descuento debe estar entre 0 y 100.');
      return;
    }
    const response = await fetch(apiUrl('/api/admin/products/discounts'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ discount_percent: discount })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo aplicar el descuento.');
      return;
    }
    setInventory(data.products || []);
    setMessage(discount ? `Descuento del ${discount}% aplicado a todas las camisetas.` : 'Descuentos retirados de todas las camisetas.');
  };

  const loadOrderDetail = async (orderId, force = false) => {
    if (expandedOrderId === orderId && !force) {
      setExpandedOrderId(null);
      return;
    }

    if (orderDetails[orderId] && !force) {
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

  const startOrderItemEdit = (orderId, item = null) => {
    const selectedProduct = item ? inventory.find((product) => product.id === Number(item.product_id)) : inventory.find((product) => Number(product.stock) > 0);
    const firstSize = selectedProduct ? Object.keys(selectedProduct.stock_by_size || {}).find((size) => Number(selectedProduct.stock_by_size[size]) > 0) || '' : '';
    const dorsalMode = item?.custom_name ? 'custom' : item?.no_dorsal ? 'none' : item?.dorsal_number ? 'catalog' : 'none';
    setEditingOrderItemId(item?.id || null);
    setOrderItemForm({ product_id: item?.product_id || selectedProduct?.id || '', size: item?.size || firstSize, quantity: item?.quantity || 1, dorsalMode, dorsalId: '', customName: item?.custom_name || '', customNumber: item?.custom_number || '' });
    setOrderItemDorsals([]);
    if (item?.product_id || selectedProduct?.id) {
      const productId = item?.product_id || selectedProduct.id;
      fetch(apiUrl(`/api/products/${productId}`)).then((response) => response.json()).then((product) => {
        const dorsals = product.dorsals || [];
        setOrderItemDorsals(dorsals);
        if (item?.dorsal_number) {
          const currentDorsal = dorsals.find((dorsal) => Number(dorsal.dorsal_number) === Number(item.dorsal_number));
          if (currentDorsal) setOrderItemForm((current) => ({ ...current, dorsalId: String(currentDorsal.id) }));
        }
      }).catch(() => setOrderItemDorsals([]));
    }
    setEditingOrderItems(orderId);
  };

  const saveOrderItem = async (orderId) => {
    if (!orderId || !orderItemForm.product_id || !orderItemForm.size) {
      setMessage('Selecciona una camiseta y una talla.');
      return;
    }
    const selectedDorsal = orderItemDorsals.find((item) => String(item.id) === String(orderItemForm.dorsalId));
    if (orderItemForm.dorsalMode === 'catalog' && !selectedDorsal) {
      setMessage('Selecciona un dorsal disponible.');
      return;
    }
    if (orderItemForm.dorsalMode === 'custom' && (!orderItemForm.customName.trim() || !orderItemForm.customNumber.trim())) {
      setMessage('Completa el nombre y número de la personalización.');
      return;
    }
    const editing = Boolean(editingOrderItemId);
    const response = await fetch(apiUrl(editing ? `/api/admin/orders/${orderId}/items/${editingOrderItemId}` : `/api/admin/orders/${orderId}/items`), {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({
        product_id: orderItemForm.product_id,
        size: orderItemForm.size,
        quantity: orderItemForm.quantity,
        no_dorsal: orderItemForm.dorsalMode === 'none',
        dorsal_number: orderItemForm.dorsalMode === 'catalog' ? selectedDorsal.dorsal_number : null,
        dorsal_name: orderItemForm.dorsalMode === 'catalog' ? selectedDorsal.player_name : null,
        custom_name: orderItemForm.dorsalMode === 'custom' ? orderItemForm.customName.trim() : null,
        custom_number: orderItemForm.dorsalMode === 'custom' ? orderItemForm.customNumber.trim() : null
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo agregar el producto al pedido.');
      return;
    }
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, total_amount: data.total_amount } : order));
    setEditingOrderItems(false);
    setEditingOrderItemId(null);
    setMessage(editing ? `Producto actualizado en el pedido #${orderId}.` : `Producto agregado al pedido #${orderId}.`);
    await loadOrderDetail(orderId, true);
  };

  const removeOrderItem = async (orderId, itemId) => {
    const response = await fetch(apiUrl(`/api/admin/orders/${orderId}/items/${itemId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo eliminar el producto del pedido.');
      return;
    }
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, total_amount: data.total_amount } : order));
    setMessage(`Producto eliminado del pedido #${orderId}.`);
    await loadOrderDetail(orderId, true);
  };

  const getManualOrderAvailableStock = (product, size) => {
    if (!product) return 0;
    const stockBySize = product.stock_by_size || {};
    const tracksSizes = Object.keys(stockBySize).length > 0;
    const stock = tracksSizes ? Number(stockBySize[size] || 0) : Number(product.stock || 0);
    const alreadyAdded = manualOrderForm.items
      .filter((item) => Number(item.product_id) === Number(product.id) && (!tracksSizes || item.size === size))
      .reduce((total, item) => total + Number(item.quantity || 0), 0);
    return Math.max(0, stock - alreadyAdded);
  };

  const addManualOrderItem = () => {
    if (!manualOrderItemForm.product_id || !manualOrderItemForm.size) {
      setMessage('Selecciona una camiseta y la talla antes de agregarla al pedido.');
      return;
    }
    const product = inventory.find((item) => Number(item.id) === Number(manualOrderItemForm.product_id));
    if (!product) {
      setMessage('La camiseta seleccionada no existe en el inventario.');
      return;
    }
    if (manualOrderItemForm.dorsalMode === 'none' && product.allow_no_dorsal === false) {
      setMessage(`La camiseta ${product.title} no se vende sin dorsal.`);
      return;
    }
    if (manualOrderItemForm.dorsalMode === 'catalog' && product.allow_catalog_dorsal === false) {
      setMessage(`La camiseta ${product.title} no permite dorsales de jugador.`);
      return;
    }
    if (manualOrderItemForm.dorsalMode === 'custom' && product.allow_custom_dorsal === false) {
      setMessage(`La camiseta ${product.title} no permite personalización.`);
      return;
    }
    if (!['none', 'catalog', 'custom'].includes(manualOrderItemForm.dorsalMode)) {
      setMessage('Selecciona una modalidad de dorsal permitida para esta camiseta.');
      return;
    }
    const selectedDorsal = manualOrderDorsals.find((item) => String(item.id) === String(manualOrderItemForm.dorsalId));
    if (manualOrderItemForm.dorsalMode === 'catalog' && !selectedDorsal) {
      setMessage('Selecciona un dorsal disponible para este producto.');
      return;
    }
    if (manualOrderItemForm.dorsalMode === 'custom' && (!manualOrderItemForm.customName.trim() || !manualOrderItemForm.customNumber.trim())) {
      setMessage('Completa el nombre y número de la personalización.');
      return;
    }
    const quantity = Math.max(1, Number(manualOrderItemForm.quantity) || 1);
    const availableStock = getManualOrderAvailableStock(product, manualOrderItemForm.size);
    if (quantity > availableStock) {
      setMessage(`No hay suficiente stock para la talla ${manualOrderItemForm.size}. Disponibles: ${availableStock}.`);
      return;
    }
    setManualOrderForm((current) => ({
      ...current,
      items: [...current.items, {
        product_id: Number(product.id),
        title: product.title,
        size: manualOrderItemForm.size,
        quantity,
        no_dorsal: manualOrderItemForm.dorsalMode === 'none',
        dorsal_number: manualOrderItemForm.dorsalMode === 'catalog' ? Number(selectedDorsal.dorsal_number) : null,
        dorsal_name: manualOrderItemForm.dorsalMode === 'catalog' ? selectedDorsal.player_name : null,
        custom_name: manualOrderItemForm.dorsalMode === 'custom' ? manualOrderItemForm.customName.trim() : null,
        custom_number: manualOrderItemForm.dorsalMode === 'custom' ? manualOrderItemForm.customNumber.trim() : null,
        unit_price: Number(product.final_price ?? product.price)
      }]
    }));
    setManualOrderItemForm({ product_id: '', size: '', quantity: 1, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' });
    setManualOrderDorsals([]);
  };

  const removeManualOrderItem = (productId, size) => {
    setManualOrderForm((current) => ({
      ...current,
      items: current.items.filter((item) => !(Number(item.product_id) === Number(productId) && item.size === size))
    }));
  };

  const createManualOrder = async () => {
    if (!manualOrderForm.client.name.trim() || !manualOrderForm.client.email.trim()) {
      setMessage('Completa el nombre y el correo del cliente antes de guardar el pedido.');
      return;
    }
    if (!manualOrderForm.items.length) {
      setManualOrderError('Agrega al menos un producto para crear el pedido manualmente.');
      return;
    }
    if (manualOrderForm.delivery_method === 'national' && (!manualOrderForm.shipping_details.name || !manualOrderForm.shipping_details.phone || !manualOrderForm.shipping_details.cedula || !manualOrderForm.shipping_details.agency || !manualOrderForm.shipping_details.city || !manualOrderForm.shipping_details.state)) {
      setManualOrderError('Completa todos los datos del envío nacional.');
      setManualOrderStep(1);
      return;
    }
    if (!manualOrderForm.first_payment_proof) {
      setManualOrderError('Adjunta el comprobante del pago para continuar.');
      setManualOrderStep(3);
      return;
    }
    const parsedFirstPaymentAmount = parseLocalizedAmount(manualOrderForm.first_payment_amount);
    const parsedFullPaymentAmount = parseLocalizedAmount(manualOrderForm.full_payment_amount);
    const parsedDeliveryPaymentAmount = parseLocalizedAmount(manualOrderForm.delivery_payment_amount);
    if (manualOrderForm.payment_plan === 'installments' && (!Number.isFinite(parsedFirstPaymentAmount) || parsedFirstPaymentAmount <= 0)) {
      setManualOrderError('Indica el monto del primer abono.');
      setManualOrderStep(3);
      return;
    }
    if (manualOrderForm.payment_plan === 'full' && (!Number.isFinite(parsedFullPaymentAmount) || parsedFullPaymentAmount <= 0)) {
      setManualOrderError('Indica el monto recibido por el pago completo.');
      setManualOrderStep(3);
      return;
    }
    if (manualOrderForm.payment_plan === 'installments' && manualOrderForm.delivery_payment_proof && (!Number.isFinite(parsedDeliveryPaymentAmount) || parsedDeliveryPaymentAmount <= 0)) {
      setManualOrderError('Indica el monto recibido en el pago final.');
      setManualOrderStep(3);
      return;
    }
    const payload = {
      client: {
        name: manualOrderForm.client.name.trim(),
        email: manualOrderForm.client.email.trim(),
        phone: manualOrderForm.client.phone.trim()
      },
      items: manualOrderForm.items.map((item) => ({
        product_id: item.product_id,
        size: item.size,
        quantity: item.quantity,
        no_dorsal: item.no_dorsal,
        dorsal_number: item.dorsal_number || null,
        dorsal_name: item.dorsal_name || null,
        custom_name: item.custom_name || null,
        custom_number: item.custom_number || null
      })),
      payment_method: manualOrderForm.payment_method,
      payment_plan: manualOrderForm.payment_plan,
      delivery_method: manualOrderForm.delivery_method,
      shipping_details: manualOrderForm.delivery_method === 'national' ? manualOrderForm.shipping_details : null,
      status: manualOrderForm.status
    };

    const formData = new FormData();
    formData.append('client', JSON.stringify(payload.client));
    formData.append('items', JSON.stringify(payload.items));
    formData.append('payment_method', payload.payment_method);
    formData.append('payment_plan', payload.payment_plan);
    formData.append('first_payment_amount', manualOrderForm.payment_plan === 'installments' ? parsedFirstPaymentAmount.toFixed(2) : '0');
    formData.append('first_payment_currency', manualOrderForm.first_payment_currency);
    formData.append('full_payment_amount', manualOrderForm.payment_plan === 'full' ? parsedFullPaymentAmount.toFixed(2) : '0');
    formData.append('delivery_payment_amount', manualOrderForm.payment_plan === 'installments' && Number.isFinite(parsedDeliveryPaymentAmount) ? parsedDeliveryPaymentAmount.toFixed(2) : '0');
    formData.append('delivery_payment_currency', manualOrderForm.delivery_payment_currency);
    formData.append('delivery_method', payload.delivery_method);
    formData.append('shipping_details', JSON.stringify(payload.shipping_details));
    formData.append('status', payload.status);
    formData.append('payment_proof_url', manualOrderForm.first_payment_proof || '');
    formData.append('delivery_payment_proof_url', manualOrderForm.payment_plan === 'installments' ? manualOrderForm.delivery_payment_proof || '' : '');
    const response = await fetch(apiUrl('/api/admin/orders/manual'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setManualOrderError(data.error || 'No se pudo crear el pedido manualmente.');
      return;
    }
    setOrders((current) => [data.order, ...current]);
    setManualOrderOpen(false);
    setManualOrderStep(1);
    setManualOrderError('');
    setManualOrderForm(createEmptyManualOrderForm());
    setManualOrderItemForm({ product_id: '', size: '', quantity: 1, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' });
    setManualOrderDorsals([]);
    setMessage(`Pedido #${data.order.id} creado correctamente.`);
    await loadDashboard();
  };

  const continueManualOrder = () => {
    if (uploadingOrderProof.startsWith('manual:')) {
      setManualOrderError('Espera a que termine la subida del comprobante.');
      return;
    }
    setManualOrderError('');
    if (manualOrderStep === 1) {
      if (!manualOrderForm.client.name.trim() || !manualOrderForm.client.email.trim()) {
        setManualOrderError('Completa el nombre y el correo del cliente.');
        return;
      }
      if (manualOrderForm.delivery_method === 'national' && (!manualOrderForm.shipping_details.name || !manualOrderForm.shipping_details.phone || !manualOrderForm.shipping_details.cedula || !manualOrderForm.shipping_details.agency || !manualOrderForm.shipping_details.city || !manualOrderForm.shipping_details.state)) {
        setManualOrderError('Completa todos los datos del envío nacional.');
        return;
      }
      setManualOrderStep(2);
      return;
    }
    if (manualOrderStep === 2) {
      if (!manualOrderForm.items.length) {
        setManualOrderError('Agrega al menos un producto al pedido.');
        return;
      }
      setManualOrderStep(3);
      return;
    }
    if (!manualOrderForm.first_payment_proof) {
      setManualOrderError('Adjunta el comprobante del pago para continuar.');
      return;
    }
    createManualOrder();
  };

  const closeManualOrder = () => {
    setManualOrderOpen(false);
    setManualOrderStep(1);
    setManualOrderError('');
    setManualOrderForm(createEmptyManualOrderForm());
    setManualOrderItemForm({ product_id: '', size: '', quantity: 1, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' });
    setManualOrderDorsals([]);
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

  const performResetRevenueMetrics = async () => {
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

  const requestConfirmation = (title, message, action) => {
    setConfirmation({ title, message, action });
  };

  const confirmAction = async () => {
    const action = confirmation?.action;
    setConfirmation(null);
    await action?.();
  };

  const resetRevenueMetrics = () => requestConfirmation(
    'Reiniciar métricas',
    'Se reiniciarán las métricas de dinero recaudado desde este momento. Los pedidos no se eliminarán.',
    performResetRevenueMetrics
  );

  const loadClosureSummary = async (periodType = closurePeriod, referenceDate = closureDate) => {
    const token = localStorage.getItem('token');
    const endpoint = periodType === 'day'
      ? '/api/admin/closures/daily'
      : `/api/admin/closures?period=${periodType}&date=${referenceDate}`;
    const response = await fetch(apiUrl(endpoint), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    setClosureSummary(data);
    if (periodType === 'day') setDailyClosureOpen(data.isOpen);
    return data;
  };

  useEffect(() => {
    loadClosureSummary('day');
  }, []);

  const createClosure = async () => {
    setIsClosing(true);
    try {
      const token = localStorage.getItem('token');
      const isDaily = closurePeriod === 'day';
      const response = await fetch(apiUrl(isDaily ? '/api/admin/closures/daily/close' : '/api/admin/closures'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ periodType: closurePeriod, referenceDate: closureDate })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo generar el cierre');
      }
      setClosureSummary(data);
      if (isDaily) setDailyClosureOpen(false);
      setMessage(`Cierre generado para ${data.periodLabel}`);
    } catch (error) {
      setMessage(error.message || 'No se pudo generar el cierre financiero.');
    } finally {
      setIsClosing(false);
    }
  };

  const openDailyClosureCount = async () => {
    const response = await fetch(apiUrl('/api/admin/closures/daily/open'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error || 'No se pudo abrir el conteo diario.');
      return;
    }
    setDailyClosureOpen(true);
    setClosureSummary(data);
    setMessage('Conteo diario nuevo abierto.');
  };

  const printClosure = () => {
    if (!closureSummary) return;
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) return;
    const generatedAt = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
    const rows = (closureSummary.orders || []).map((order) => `
      <tr>
        <td>#${order.id}</td>
        <td>${new Date(order.createdAt).toLocaleString('es-VE')}</td>
        <td>${formatCurrency(order.totalAmount, 'USD')}</td>
      </tr>
    `).join('');
    const paymentRows = (closureSummary.payments || []).map((payment) => `
      <tr>
        <td>#${payment.orderId}</td>
        <td>${payment.kind}</td>
        <td>${new Date(payment.receivedAt).toLocaleString('es-VE')}</td>
        <td>${formatCurrency(payment.amount, payment.currency)}</td>
        <td>${formatCurrency(payment.remainingUsd, 'USD')} · ${formatCurrency(payment.remainingBs, 'BS')}</td>
      </tr>
    `).join('');
    const paymentTotals = closureSummary.paymentTotals || { USD: 0, BS: 0, totalUsd: 0 };

    printWindow.document.write(`
      <html>
        <head>
          <title>Cierre ${closureSummary.periodLabel}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 32px; background: #f4f8ff; color: #0f172a; font-family: Arial, sans-serif; }
            .page { max-width: 900px; margin: 0 auto; }
            .brand { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 22px 26px; border-radius: 12px; background: #0f2d52; color: #fff; }
            .brand-name { margin: 0; font-size: 21px; font-weight: 700; }
            .brand-caption { margin: 6px 0 0; color: #cfe4ff; font-size: 11px; }
            .report-tag { padding: 10px 16px; border-radius: 8px; background: #1d4ed8; color: #fff; text-align: center; }
            .report-tag strong { display: block; font-size: 10px; }
            .report-tag span { display: block; margin-top: 5px; color: #dbeafe; font-size: 11px; }
            .report-tag small { display: block; margin-top: 5px; color: #dbeafe; font-size: 10px; }
            .period { margin: 22px 0 14px; }
            h1 { margin: 0; color: #0f2d52; font-size: 20px; }
            .muted { margin: 6px 0 0; color: #64748b; font-size: 12px; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 22px; }
            .summary div { min-height: 72px; padding: 14px 16px; border: 1px solid #dbeafe; border-radius: 8px; background: #fff; }
            .summary strong { color: #64748b; font-size: 10px; text-transform: uppercase; }
            .summary span { display: block; margin-top: 8px; color: #0f2d52; font-size: 18px; font-weight: 700; }
            table { width: 100%; border-spacing: 0; border-collapse: separate; overflow: hidden; border-radius: 7px; background: #fff; }
            thead { background: #0f2d52; color: #fff; }
            th { padding: 11px 12px; font-size: 10px; font-weight: 700; text-align: left; }
            td { padding: 10px 12px; border-bottom: 1px solid #dbeafe; font-size: 11px; }
            tbody tr:nth-child(even) { background: #f1f6fc; }
            tbody tr:last-child td { border-bottom: 0; }
            .amount { text-align: right; }
            .footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #dbe5f1; color: #64748b; font-size: 9px; text-align: center; }
            @media (max-width: 600px) { body { padding: 16px; } .brand { padding: 18px; } .summary { gap: 8px; } .summary div { padding: 11px; } }
            @page { margin: 0; }
            @media print { body { padding: 32px; background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; } .page { max-width: none; } .brand, thead { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
          </style>
        </head>
        <body>
          <main class="page">
            <header class="brand">
              <div>
                <p class="brand-name">MDJ SOCCER</p>
                <p class="brand-caption">Camisetas deportivas · San Cristóbal</p>
              </div>
              <div class="report-tag"><strong>CIERRE DE VENTAS</strong><span>${closureSummary.periodLabel}</span><small>Generado: ${generatedAt}</small></div>
            </header>
            <section class="period">
              <h1>Resumen de ventas</h1>
              <p class="muted">Periodo: ${closureSummary.periodType === 'day' ? 'Diario' : closureSummary.periodType === 'month' ? 'Mensual' : 'Anual'}</p>
            </section>
            <section class="summary">
              <div><strong>Valor de pedidos aprobados</strong><span>${formatCurrency(closureSummary.totalAmount, 'USD')}</span></div>
              <div><strong>Pedidos</strong><span>${closureSummary.ordersCount}</span></div>
              <div><strong>Unidades vendidas</strong><span>${closureSummary.itemsSold}</span></div>
            </section>
            <table>
              <thead>
                <tr><th># Pedido</th><th>Fecha</th><th class="amount">Monto</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <section class="period">
              <h1>Pagos recibidos en el período</h1>
              <p class="muted">Total recibido: ${formatCurrency(paymentTotals.USD, 'USD')} · ${formatCurrency(paymentTotals.BS, 'BS')} · Equivalente: ${formatCurrency(paymentTotals.totalUsd, 'USD')}</p>
            </section>
            <table>
              <thead>
                <tr><th># Pedido</th><th>Pago</th><th>Fecha</th><th>Recibido</th><th>Saldo restante · USD / Bs</th></tr>
              </thead>
              <tbody>${paymentRows || '<tr><td colspan="5">No hubo pagos registrados en este período.</td></tr>'}</tbody>
            </table>
            <footer class="footer">MDJ SOCCER · San Cristóbal, Táchira, Venezuela · +58 0414-714-6602</footer>
          </main>
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
    setClubForm({ name: club.name || '', country: club.country || '', logo_url: club.logo_url || '', category: club.category || 'club' });
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
    setAdminMenuOpen(false);
    navigate(`/admin?view=${view}`);
  };

  const adminSections = [
    { value: 'overview', label: 'Resumen', description: 'Ventas, métricas y cierres' },
    { value: 'inventory', label: 'Inventario', description: 'Camisetas, stock y descuentos' },
    { value: 'stock-requests', label: 'Pedidos por encargo', description: 'Apartados de modelos fuera de stock' },
    { value: 'orders', label: 'Pedidos', description: 'Clientes, estados y facturas' },
    { value: 'users', label: 'Usuarios', description: 'Clientes y administradores' },
    { value: 'clubs', label: 'Clubes y selecciones', description: 'Equipos y escudos' },
    { value: 'content', label: 'Contenido visual', description: 'Banners, fotos y videos' },
    { value: 'audit', label: 'Auditoría', description: 'Historial de cambios' }
  ];

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

  const selectStockRequestImage = (event) => {
    setStockRequestError('');
    const file = event.currentTarget.files?.[0] || null;
    if (file && !['image/jpeg', 'image/png'].includes(file.type)) {
      setStockRequestError('La imagen debe estar en formato JPG o PNG.');
      event.currentTarget.value = '';
      return;
    }
    if (file && file.size > 8 * 1024 * 1024) {
      setStockRequestError('La imagen no puede superar los 8 MB.');
      event.currentTarget.value = '';
      return;
    }
    setStockRequestForm((current) => ({ ...current, model_image: file, image_url: '', remove_image: false }));
    setStockRequestPreview(file ? URL.createObjectURL(file) : '');
    event.currentTarget.value = '';
  };

  const openStockRequestEditor = (request) => {
    setStockRequestError('');
    if (!request) {
      setEditingStockRequestId(null);
      setStockRequestForm(createEmptyStockRequestForm());
      setStockRequestPreview('');
    } else {
      setEditingStockRequestId(request.id);
      setStockRequestForm({
        client_name: request.client_name || '',
        phone: request.phone || '',
        email: request.email || '',
        model: request.model || '',
        shirt_type: request.shirt_type || 'local',
        size: request.size || '',
        size_quantities: {
          ...Object.fromEntries(sizeOptions.map((size) => [size, ''])),
          ...(request.size_quantities || { [request.size]: 1 })
        },
        printed_details: request.printed_details?.length
          ? request.printed_details.map((detail) => ({
            ...detail,
            quantity: String(detail.quantity),
            dorsal: String(detail.dorsal)
          }))
          : request.has_print
            ? Object.entries(request.size_quantities || { [request.size]: 1 }).map(([size, quantity]) => ({
              size,
              quantity: String(quantity),
              printed_name: request.printed_name || '',
              dorsal: request.dorsal || ''
            }))
            : [],
        has_print: request.has_print === true,
        deposit_amount: String(request.deposit_amount ?? ''),
        deposit_currency: request.deposit_currency || 'USD',
        notes: request.notes || '',
        model_image: null,
        image_url: request.image_url || '',
        remove_image: false
      });
      setStockRequestPreview(request.image_url ? assetUrl(request.image_url) : '');
    }
    setStockRequestModalOpen(true);
  };

  const closeStockRequestEditor = () => {
    if (isSavingStockRequest) return;
    setStockRequestModalOpen(false);
    setEditingStockRequestId(null);
    setStockRequestForm(createEmptyStockRequestForm());
    setStockRequestPreview('');
    setStockRequestError('');
  };

  const saveStockRequest = async (event) => {
    event.preventDefault();
    setStockRequestError('');
    if (stockRequestFrom && stockRequestTo && stockRequestFrom > stockRequestTo) {
      setStockRequestError('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    setIsSavingStockRequest(true);
    try {
      const formData = new FormData();
      Object.entries(stockRequestForm).forEach(([key, value]) => {
        if (!['model_image', 'image_url', 'printed_details'].includes(key)) {
          formData.append(key, key === 'size_quantities' ? JSON.stringify(value) : String(value ?? ''));
        }
      });
      formData.append('printed_details', JSON.stringify(stockRequestForm.printed_details));
      if (stockRequestForm.model_image) formData.append('model_image', stockRequestForm.model_image);
      const isEditing = Boolean(editingStockRequestId);
      const response = await fetch(apiUrl(isEditing
        ? `/api/admin/stock-requests/${editingStockRequestId}`
        : '/api/admin/stock-requests'), {
        method: isEditing ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (response.status === 404 && !isEditing
        ? 'La ruta para registrar apartados no existe en el backend activo. Reinicia o vuelve a desplegar el backend actualizado.'
        : `No se pudo ${isEditing ? 'actualizar' : 'registrar'} el pedido por encargo.`));
      setStockRequestForm(createEmptyStockRequestForm());
      setStockRequestPreview('');
      setStockRequestModalOpen(false);
      setEditingStockRequestId(null);
      await loadStockRequests();
      setMessage(isEditing
        ? 'Apartado actualizado correctamente.'
        : 'Pedido por encargo registrado. El abono queda separado del estado de cuenta.');
    } catch (error) {
      setStockRequestError(error.message || `No se pudo ${editingStockRequestId ? 'actualizar' : 'registrar'} el pedido por encargo.`);
    } finally {
      setIsSavingStockRequest(false);
    }
  };

  const deleteStockRequest = (request) => requestConfirmation(
    'Eliminar apartado',
    `¿Quieres eliminar definitivamente el apartado de ${request.client_name} para ${request.model}? Esta acción no se puede deshacer.`,
    async () => {
      setStockRequestError('');
      const token = localStorage.getItem('token');
      if (!token) {
        setStockRequestError('Tu sesión expiró. Inicia sesión nuevamente para eliminar el apartado.');
        return;
      }
      try {
        const response = await apiFetch(`/api/admin/stock-requests/${request.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo eliminar el apartado.');
        await loadStockRequests();
        setMessage('Apartado eliminado correctamente.');
      } catch (error) {
        setStockRequestError(error.message || 'No se pudo eliminar el apartado.');
      }
    }
  );

  const downloadStockRequestsPdf = async () => {
    if (stockRequestFrom && stockRequestTo && stockRequestFrom > stockRequestTo) {
      setStockRequestError('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    setIsDownloadingStockRequests(true);
    setStockRequestError('');
    try {
      const query = new URLSearchParams();
      if (stockRequestFrom) query.set('from', stockRequestFrom);
      if (stockRequestTo) query.set('to', stockRequestTo);
      const response = await fetch(apiUrl(`/api/admin/stock-requests/pdf${query.toString() ? `?${query}` : ''}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar el PDF de pedidos por encargo.');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pedidos-por-encargo${stockRequestFrom ? `-${stockRequestFrom}` : ''}${stockRequestTo ? `-${stockRequestTo}` : ''}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setStockRequestError(error.message || 'No se pudo generar el PDF de pedidos por encargo.');
    } finally {
      setIsDownloadingStockRequests(false);
    }
  };

  const saveCashWithdrawal = async (event) => {
    event.preventDefault();
    setWithdrawalError('');
    const amountUsd = parseLocalizedAmount(withdrawalAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setWithdrawalError('Indica un monto en dólares mayor que cero.');
      return;
    }
    if (!withdrawalConcept.trim()) {
      setWithdrawalError('Indica el concepto del retiro.');
      return;
    }
    setIsSavingWithdrawal(true);
    try {
      const response = await apiFetch('/api/admin/cash-withdrawals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ amount_usd: amountUsd, concept: withdrawalConcept.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar el retiro.');
      setCashWithdrawals((current) => [data, ...current]);
      setWithdrawalAmount('');
      setWithdrawalConcept('');
      setWithdrawalFormOpen(false);
      setMessage('Retiro registrado y descontado del total ingresado.');
    } catch (error) {
      setWithdrawalError(error.message || 'No se pudo registrar el retiro.');
    } finally {
      setIsSavingWithdrawal(false);
    }
  };

  const downloadInventoryPdf = async () => {
    setIsDownloadingInventoryPdf(true);
    try {
      const response = await apiFetch('/api/admin/inventory/pdf', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar el PDF del inventario.');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inventario-camisetas.pdf';
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('PDF de inventario descargado correctamente.');
    } catch (error) {
      setMessage(error.message || 'No se pudo generar el PDF del inventario.');
    } finally {
      setIsDownloadingInventoryPdf(false);
    }
  };

  const downloadApprovedOrders = async () => {
    if (!approvedPdfFrom || !approvedPdfTo || approvedPdfFrom > approvedPdfTo || approvedPdfTo > today) {
      setMessage('Selecciona un rango válido, sin fechas futuras y con inicio anterior al fin.');
      return;
    }
    try {
      const query = new URLSearchParams({ from: approvedPdfFrom, to: approvedPdfTo });
      const response = await fetch(apiUrl(`/api/admin/orders/approved/pdf?${query}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        setMessage('No se pudo generar el PDF de pedidos aceptados.');
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pedidos-aceptados-${approvedPdfFrom}-${approvedPdfTo}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('PDF de pedidos aceptados descargado correctamente.');
    } catch (error) {
      setMessage('No se pudo generar el PDF de pedidos aceptados.');
    }
  };

  if (!dashboard) return <div className="container">Cargando...</div>;

  const normalizedOrderSearch = normalizeSearchText(orderSearch);
  const filteredOrders = orders.filter((order) => {
    const matchesStatus = orderFilter === 'all' || order.status === orderFilter;
    const hasFirstProof = Boolean(order.payment_proof_url);
    const hasFinalProof = Boolean(order.delivery_payment_proof_url);
    const isInstallment = order.payment_plan === 'installments';
    const matchesInstallment = installmentFilter === 'all'
      || (installmentFilter === 'pending' && isInstallment && hasFirstProof !== hasFinalProof)
      || (installmentFilter === 'completed' && isInstallment && hasFirstProof && hasFinalProof);
    const matchesSearch = !normalizedOrderSearch
      || String(order.id).includes(normalizedOrderSearch)
      || normalizeSearchText(order.client?.name || '').includes(normalizedOrderSearch)
      || normalizeSearchText(order.client?.email || '').includes(normalizedOrderSearch);
    return matchesStatus && matchesSearch && matchesInstallment;
  });
  const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
  const visibleOrders = filteredOrders.slice((orderPage - 1) * ORDERS_PER_PAGE, orderPage * ORDERS_PER_PAGE);
  const normalizedInventorySearch = normalizeSearchText(inventorySearch);
  const filteredInventory = inventory.filter((product) => {
    if (!normalizedInventorySearch) return true;
    const productName = normalizeSearchText(product.title || '');
    const clubName = normalizeSearchText(product.club?.name || '');
    const productType = normalizeSearchText(product.type || '');
    return productName.includes(normalizedInventorySearch) || clubName.includes(normalizedInventorySearch) || productType.includes(normalizedInventorySearch);
  });
  const filteredAdminClubs = clubs.filter((club) => clubCategoryFilter === 'all' || (club.category || 'club') === clubCategoryFilter);
  const currentInventoryPage = Math.min(inventoryPage, Math.max(1, Math.ceil(filteredInventory.length / ADMIN_ITEMS_PER_PAGE)));
  const currentClubsPage = Math.min(clubsPage, Math.max(1, Math.ceil(filteredAdminClubs.length / ADMIN_ITEMS_PER_PAGE)));
  const currentContentPage = Math.min(contentPage, Math.max(1, Math.ceil(content.length / ADMIN_ITEMS_PER_PAGE)));
  const currentAuditPage = Math.min(auditPage, Math.max(1, Math.ceil(auditLogs.length / ADMIN_ITEMS_PER_PAGE)));
  const visibleInventory = filteredInventory.slice((currentInventoryPage - 1) * ADMIN_ITEMS_PER_PAGE, currentInventoryPage * ADMIN_ITEMS_PER_PAGE);
  const visibleClubs = filteredAdminClubs.slice((currentClubsPage - 1) * ADMIN_ITEMS_PER_PAGE, currentClubsPage * ADMIN_ITEMS_PER_PAGE);
  const visibleContent = content.slice((currentContentPage - 1) * ADMIN_ITEMS_PER_PAGE, currentContentPage * ADMIN_ITEMS_PER_PAGE);
  const visibleAuditLogs = auditLogs.slice((currentAuditPage - 1) * ADMIN_ITEMS_PER_PAGE, currentAuditPage * ADMIN_ITEMS_PER_PAGE);
  const closureOrders = closureSummary?.orders || [];
  const currentClosurePage = Math.min(closurePage, Math.max(1, Math.ceil(closureOrders.length / ADMIN_ITEMS_PER_PAGE)));
  const visibleClosureOrders = closureOrders.slice((currentClosurePage - 1) * ADMIN_ITEMS_PER_PAGE, currentClosurePage * ADMIN_ITEMS_PER_PAGE);
  const expandedOrderItems = orderDetails[expandedOrderId]?.items || [];
  const currentOrderItemsPage = Math.min(orderItemsPage, Math.max(1, Math.ceil(expandedOrderItems.length / ADMIN_ITEMS_PER_PAGE)));
  const visibleOrderItems = expandedOrderItems.slice((currentOrderItemsPage - 1) * ADMIN_ITEMS_PER_PAGE, currentOrderItemsPage * ADMIN_ITEMS_PER_PAGE);
  const renderExpandedOrderRow = (order) => {
    const detail = orderDetails[order.id];
    if (!detail) return null;
    return (
      <tr className="order-expanded-row" key={`order-detail-${order.id}`}>
        <td className="order-expanded-row__cell" colSpan={7}>
          <div className="card order-expanded-panel">
            <div className="order-detail__header">
              <h4>Detalle del pedido #{order.id}</h4>
              <button className="icon-btn" type="button" onClick={() => startOrderItemEdit(order.id)} title="Editar pedido y agregar producto" aria-label={`Editar pedido ${order.id}`}>✎</button>
            </div>
            {detail.order?.delivery_method === 'national' ? (
              <div className="shipping-summary">
                <h5>Datos de envío nacional</h5>
                <p><strong>Nombre:</strong> {detail.order.shipping_details?.name}</p>
                <p><strong>Teléfono:</strong> {detail.order.shipping_details?.phone}</p>
                <p><strong>Cédula:</strong> {detail.order.shipping_details?.cedula}</p>
                <p><strong>Agencia:</strong> {detail.order.shipping_details?.agency}</p>
                <p><strong>Destino:</strong> {detail.order.shipping_details?.city}, {detail.order.shipping_details?.state}</p>
              </div>
            ) : <p className="delivery-summary">Entrega personal en San Cristóbal</p>}
            {['payment_proof_url', 'delivery_payment_proof_url'].some((key) => detail.order?.[key]) ? (
              <div className="order-expanded-panel__proofs">
                {[
                  ['payment_proof_url', detail.order?.payment_plan === 'installments' ? 'Comprobante del primer pago' : 'Comprobante del pago completo'],
                  ['delivery_payment_proof_url', 'Comprobante al entregar']
                ].map(([key, label]) => detail.order?.[key] ? (
                  <div key={key}>
                    <h5>{label}</h5>
                    <a href={getProofUrl(detail.order[key])} target="_blank" rel="noreferrer">
                      <img src={getProofUrl(detail.order[key])} alt={label} />
                    </a>
                  </div>
                ) : null)}
              </div>
            ) : null}
            <ul className="dashboard-list">
              {visibleOrderItems.map((item) => (
                <li key={item.id}>
                  <span>{item.product_title || `Producto #${item.product_id}`} · Talla {item.size || 'No indicada'} · {item.no_dorsal ? 'Sin dorsal' : item.custom_name ? `Personalizada: ${item.custom_name} #${item.custom_number}` : item.dorsal_number ? `Dorsal ${item.dorsal_number}${item.dorsal_name ? ` (${item.dorsal_name})` : ''}` : 'Sin dorsal'} · {item.quantity} und.</span>
                  <span className="order-item-actions">
                    <strong>{formatCurrency(Number(item.unit_price || 0) * Number(item.quantity || 1), 'USD')}</strong>
                    <button className="icon-btn" type="button" onClick={() => startOrderItemEdit(order.id, item)} title="Editar talla o dorsal" aria-label={`Editar ${item.product_title || 'producto'} del pedido`}>✎</button>
                    <button className="icon-btn icon-btn--danger" type="button" onClick={() => requestConfirmation('Eliminar producto del pedido', `¿Eliminar ${item.product_title || 'este producto'} del pedido?`, () => removeOrderItem(order.id, item.id))} title="Eliminar producto del pedido" aria-label={`Eliminar ${item.product_title || 'producto'} del pedido`}>🗑</button>
                  </span>
                </li>
              ))}
            </ul>
            <AdminPagination page={currentOrderItemsPage} totalItems={expandedOrderItems.length} onPageChange={setOrderItemsPage} label="productos del pedido" />
          </div>
        </td>
      </tr>
    );
  };
  const setOrderFilterAndResetPage = (filter) => {
    setOrderFilter(filter);
    setOrderPage(1);
  };
  const filteredOrderIds = filteredOrders.map((order) => order.id);
  const allFilteredOrdersSelected = filteredOrderIds.length > 0 && filteredOrderIds.every((id) => selectedOrderIds.includes(id));
  const toggleOrderSelection = (orderId) => {
    setSelectedOrderIds((current) => current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]);
  };
  const toggleAllFilteredOrders = () => {
    setSelectedOrderIds((current) => allFilteredOrdersSelected
      ? current.filter((id) => !filteredOrderIds.includes(id))
      : [...new Set([...current, ...filteredOrderIds])]);
  };
  const hasLedgerDateFilter = Boolean(ledgerDate || ledgerDateFrom || ledgerDateTo);
  const ledgerDateRange = hasLedgerDateFilter
    ? { from: ledgerDate || ledgerDateFrom, to: ledgerDate || ledgerDateTo }
    : null;
  const ledgerOrders = hasLedgerDateFilter ? orders.filter((order) => (
    isDateInRange(order.created_at, ledgerDateRange)
    || isDateInRange(order.payment_received_at || order.created_at, ledgerDateRange)
    || isDateInRange(order.delivery_payment_received_at || order.created_at, ledgerDateRange)
  )) : orders;
  const ledgerIncludedOrders = ledgerOrders.filter((order) => !['rejected', 'cancelled'].includes(order.status));
  const paymentLedger = hasLedgerDateFilter
    ? getPaymentLedger(ledgerOrders, exchangeRate, ledgerDateRange)
    : dashboard?.paymentLedger || getPaymentLedger(orders, exchangeRate);
  const ledgerDateDescription = ledgerDate
    ? `del ${new Date(`${ledgerDate}T12:00:00`).toLocaleDateString('es-VE')}`
    : ledgerDateFrom || ledgerDateTo
      ? `${ledgerDateFrom ? `desde ${new Date(`${ledgerDateFrom}T12:00:00`).toLocaleDateString('es-VE')}` : ''}${ledgerDateFrom && ledgerDateTo ? ' ' : ''}${ledgerDateTo ? `hasta ${new Date(`${ledgerDateTo}T12:00:00`).toLocaleDateString('es-VE')}` : ''}`
      : '';
  const currentExchangeRate = Number(exchangeRate || 0);
  const visibleCashWithdrawals = cashWithdrawals.filter((withdrawal) => isDateInRange(withdrawal.created_at, ledgerDateRange));
  const totalWithdrawnUsd = visibleCashWithdrawals.reduce((sum, withdrawal) => sum + Number(withdrawal.amount_usd || 0), 0);
  const generalGrossReceivedUsd = paymentLedger.USD.received + (currentExchangeRate > 0 ? paymentLedger.BS.received / currentExchangeRate : 0);
  const generalGrossReceivedBs = paymentLedger.BS.received + paymentLedger.USD.received * currentExchangeRate;
  const generalReceivedUsd = generalGrossReceivedUsd - totalWithdrawnUsd;
  const generalReceivedBs = generalGrossReceivedBs - totalWithdrawnUsd * currentExchangeRate;

  return (
    <div className="container">
      <section className="hero">
        <h2>Panel administrativo</h2>
        <p>Gestión de stock, pedidos, clubes y auditoría.</p>
      </section>

      <div className="admin-nav">
        <div className="admin-menu">
          <button className="admin-menu__trigger" type="button" onClick={() => setAdminMenuOpen((open) => !open)} aria-expanded={adminMenuOpen} aria-haspopup="menu">
            <span className="admin-menu__trigger-icon">☰</span>
            <span><small>Sección actual</small><strong>{adminSections.find((section) => section.value === activeView)?.label || 'Panel'}</strong></span>
            <span className="admin-menu__chevron" aria-hidden="true">⌄</span>
          </button>
          {adminMenuOpen ? (
            <div className="admin-menu__panel" role="menu">
              <p className="admin-menu__title">Navegación del panel</p>
              {adminSections.map((section) => (
                <button key={section.value} className={activeView === section.value ? 'admin-menu__item admin-menu__item--active' : 'admin-menu__item'} type="button" onClick={() => setView(section.value)} role="menuitem">
                  <span className="admin-menu__item-icon" aria-hidden="true">{section.value === 'overview' ? '⌂' : section.value === 'inventory' ? '▣' : section.value === 'stock-requests' ? '＋' : section.value === 'orders' ? '▤' : section.value === 'users' ? '♙' : section.value === 'clubs' ? '⚽' : section.value === 'content' ? '▧' : '◌'}</span>
                  <span><strong>{section.label}</strong><small>{section.description}</small></span>
                  {activeView === section.value ? <span className="admin-menu__check" aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {message ? <p className="badge" style={{ marginBottom: '1rem' }}>{message}</p> : null}

      {activeView === 'overview' ? (
        <div className="dashboard-shell" style={{ marginBottom: '1rem' }}>
          <div className="card dashboard-hero">
            <div>
              <p className="eyebrow">Panel financiero</p>
              <h3>Resumen general del negocio</h3>
              <p>Controla ventas, cobros en USD y Bs, saldos pendientes, inventario y pedidos.</p>
            </div>
            <div className="dashboard-rate-box">
              <span>Tasa actual</span>
              <strong>{exchangeRate.toFixed(2)} BS/USD</strong>
              <div className="dashboard-rate-actions">
                <input type="number" min="1" step="0.01" value={exchangeRateDraft} onChange={(e) => setExchangeRateDraft(e.target.value)} />
                <button className="primary-btn" onClick={updateExchangeRate}>Guardar</button>
              </div>
              <button className="ghost-btn" onClick={resetRevenueMetrics} disabled={isResettingMetrics}>
                {isResettingMetrics ? 'Restableciendo...' : 'Restablecer métricas de ventas'}
              </button>
              <small className="metric-caption">El estado de cuenta incluye los pedidos activos, sin aplicar este reinicio.</small>
            </div>
          </div>

          <div className="card dashboard-ledger">
            <div className="dashboard-ledger__header">
              <div>
                <p className="eyebrow">Estado de cuenta</p>
                <h3>Montos esperados y recibidos</h3>
                <p className="metric-caption">Esperado y pendiente se agrupan por fecha del pedido; recibido, por fecha del pago. Solo cuenta pagos confirmados. {ledgerDateDescription ? `${ledgerIncludedOrders.length} pedido(s) con actividad ${ledgerDateDescription}.` : `${ledgerIncludedOrders.length} pedido(s) incluidos en total.`}</p>
              </div>
              <div className="dashboard-ledger__legend" aria-label="Monedas según método de pago">
                <span><strong className="dashboard-ledger__currency dashboard-ledger__currency--bs">Bs</strong> Recibido en bolívares</span>
                <span><strong className="dashboard-ledger__currency dashboard-ledger__currency--usd">USD</strong> Recibido en dólares</span>
              </div>
            </div>
            <div className="dashboard-ledger__filters" aria-label="Filtrar tabla por fecha">
              <div className="dashboard-ledger__filter-buttons" role="group" aria-label="Fechas rápidas">
                <button className={!hasLedgerDateFilter ? 'dashboard-ledger__filter-btn dashboard-ledger__filter-btn--active' : 'dashboard-ledger__filter-btn'} type="button" aria-pressed={!hasLedgerDateFilter} onClick={() => {
                  setLedgerDate('');
                  setLedgerDateFrom('');
                  setLedgerDateTo('');
                }}>Todos</button>
                {['Hoy', 'Ayer', 'Antier'].map((label, daysAgo) => {
                  const date = new Date();
                  date.setDate(date.getDate() - daysAgo);
                  const value = toLocalDateInput(date);
                  return <button key={label} className={ledgerDate === value ? 'dashboard-ledger__filter-btn dashboard-ledger__filter-btn--active' : 'dashboard-ledger__filter-btn'} type="button" aria-pressed={ledgerDate === value} onClick={() => {
                    setLedgerDate(value);
                    setLedgerDateFrom('');
                    setLedgerDateTo('');
                  }}>{label}</button>;
                })}
              </div>
              <label className="dashboard-ledger__date-label">Elegir fecha
                <input type="date" value={ledgerDate} min={oldestLedgerDate} max={today} onChange={(event) => {
                  const value = event.target.value;
                  if (!value) {
                    setLedgerDate('');
                  } else if (value < oldestLedgerDate || value > today) {
                    setMessage('La fecha debe estar entre hoy y los últimos 300 años.');
                  } else {
                    setLedgerDate(value);
                  }
                  setLedgerDateFrom('');
                  setLedgerDateTo('');
                }} />
              </label>
              <div className="dashboard-ledger__range" aria-label="Filtrar entre fechas">
                <label className="dashboard-ledger__date-label">Desde
                  <input type="date" value={ledgerDateFrom} min={oldestLedgerDate} max={ledgerDateTo || today} onChange={(event) => {
                    setLedgerDate('');
                    setLedgerDateFrom(event.target.value);
                  }} />
                </label>
                <label className="dashboard-ledger__date-label">Hasta
                  <input type="date" value={ledgerDateTo} min={ledgerDateFrom || oldestLedgerDate} max={today} onChange={(event) => {
                    setLedgerDate('');
                    setLedgerDateTo(event.target.value);
                  }} />
                </label>
              </div>
            </div>
            <div className="dashboard-ledger__scroll">
              <table className="table dashboard-ledger__table">
                <thead>
                  <tr>
                    <th scope="col">Movimiento</th>
                    <th className="dashboard-ledger__column--bs" scope="col"><span>Bs</span><small>Equivalente / recibido</small></th>
                    <th className="dashboard-ledger__column--usd" scope="col"><span>USD</span><small>Equivalente / recibido</small></th>
                  </tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Total esperado</th><td>{formatCurrency(paymentLedger.BS.expected, 'BS')}</td><td>{formatCurrency(paymentLedger.USD.expected, 'USD')}</td></tr>
                  <tr><th scope="row">Abonos iniciales</th><td>{formatCurrency(paymentLedger.BS.first, 'BS')}</td><td>{formatCurrency(paymentLedger.USD.first, 'USD')}</td></tr>
                  <tr><th scope="row">Pagos finales y completos</th><td>{formatCurrency(paymentLedger.BS.other, 'BS')}</td><td>{formatCurrency(paymentLedger.USD.other, 'USD')}</td></tr>
                  <tr className="dashboard-ledger__total"><th scope="row">Total recibido</th><td>{formatCurrency(paymentLedger.BS.received, 'BS')}</td><td>{formatCurrency(paymentLedger.USD.received, 'USD')}</td></tr>
                  <tr className="dashboard-ledger__withdrawals"><th scope="row">Retiros registrados</th><td>−{formatCurrency(totalWithdrawnUsd * currentExchangeRate, 'BS')}</td><td>−{formatCurrency(totalWithdrawnUsd, 'USD')}</td></tr>
                  <tr className="dashboard-ledger__pending"><th scope="row">Pendiente por cobrar</th><td>{formatCurrency(paymentLedger.BS.pending, 'BS')}</td><td>{formatCurrency(paymentLedger.USD.pending, 'USD')}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="dashboard-ledger__general" aria-label="General ingresado convertido a ambas monedas">
              <div className="dashboard-ledger__general-title">
                <strong>GENERAL DISPONIBLE</strong>
                <small>Conversión de los cobros con la tasa actual: {currentExchangeRate} BS/USD</small>
                <button className="ghost-btn dashboard-ledger__withdrawal-trigger" type="button" onClick={() => {
                  setWithdrawalError('');
                  setWithdrawalFormOpen((open) => !open);
                }}>{withdrawalFormOpen ? 'Cancelar retiro' : '＋ Registrar retiro'}</button>
              </div>
              <div className="dashboard-ledger__general-total">
                <span>Neto en dólares</span>
                <strong>{formatCurrency(generalReceivedUsd, 'USD')}</strong>
              </div>
              <div className="dashboard-ledger__general-total">
                <span>Neto equivalente en bolívares</span>
                <strong>{formatCurrency(generalReceivedBs, 'BS')}</strong>
              </div>
            </div>
            {withdrawalFormOpen ? (
              <form className="dashboard-ledger__withdrawal-form" onSubmit={saveCashWithdrawal}>
                <button
                  className="icon-btn dashboard-ledger__withdrawal-close"
                  type="button"
                  onClick={() => {
                    setWithdrawalFormOpen(false);
                    setWithdrawalError('');
                  }}
                  aria-label="Cerrar formulario de retiro"
                  title="Cerrar"
                >×</button>
                <label className="inventory-field">
                  <span>Monto a retirar (USD) *</span>
                  <input type="number" min="0.01" step="0.01" required value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} placeholder="100.00" />
                </label>
                <label className="inventory-field">
                  <span>Concepto del retiro *</span>
                  <textarea rows="1" maxLength="500" required value={withdrawalConcept} onChange={(event) => setWithdrawalConcept(event.target.value)} placeholder="Indica para qué se realizó el retiro" />
                </label>
                <p className="metric-caption">Equivalente a {formatCurrency((parseLocalizedAmount(withdrawalAmount) || 0) * currentExchangeRate, 'BS')} según la tasa actual.</p>
                {withdrawalError ? <p className="stock-request-error" role="alert">{withdrawalError}</p> : null}
                <button className="primary-btn" type="submit" disabled={isSavingWithdrawal}>{isSavingWithdrawal ? 'Guardando...' : 'Guardar retiro'}</button>
              </form>
            ) : null}
            <div className="dashboard-ledger__withdrawal-history">
              <button className="ghost-btn" type="button" aria-expanded={withdrawalHistoryOpen} onClick={() => setWithdrawalHistoryOpen((open) => !open)}>
                {withdrawalHistoryOpen ? 'Ocultar retiros' : `Ver retiros (${visibleCashWithdrawals.length})`}
              </button>
              {withdrawalHistoryOpen ? (
                visibleCashWithdrawals.length ? (
                  <div className="dashboard-ledger__withdrawal-list">
                    {visibleCashWithdrawals.map((withdrawal) => (
                      <article className="dashboard-ledger__withdrawal-item" key={withdrawal.id}>
                        <div><strong>{withdrawal.concept}</strong><small>{new Date(withdrawal.created_at).toLocaleString('es-VE')}</small></div>
                        <span>{formatCurrency(withdrawal.amount_usd, 'USD')} · {formatCurrency(Number(withdrawal.amount_usd) * currentExchangeRate, 'BS')}</span>
                      </article>
                    ))}
                  </div>
                ) : <p className="metric-caption">No hay retiros registrados en este período.</p>
              ) : null}
            </div>
          </div>

          <div className="dashboard-grid">
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
              <span className="metric-caption">
                {(dashboard.lowStock || []).filter((product) => Number(product.stock) === 0).length} sin stock · {(dashboard.lowStock || []).filter((product) => Number(product.stock) > 0).length} con stock bajo
              </span>
            </div>
          </div>

          <div className="card">
            <h3>Productos que requieren reposición</h3>
            <div className="dashboard-stock-alerts">
              {[
                { title: 'Sin stock', products: (dashboard.lowStock || []).filter((product) => Number(product.stock) === 0) },
                { title: 'Stock bajo (1–5 unidades)', products: (dashboard.lowStock || []).filter((product) => Number(product.stock) > 0) }
              ].map((group) => (
                <section className="dashboard-stock-alerts__group" key={group.title}>
                  <h4>{group.title} <span>({group.products.length})</span></h4>
                  {group.products.length ? (
                    <ul>
                      {group.products.map((product) => {
                        const sizes = Object.entries(product.stock_by_size || {})
                          .filter(([, quantity]) => Number(quantity) > 0)
                          .map(([size, quantity]) => `${size}: ${quantity}`)
                          .join(' · ');
                        return (
                          <li key={product.id}>
                            <strong>{product.title}</strong>
                            <span>{Number(product.stock)} {Number(product.stock) === 1 ? 'unidad' : 'unidades'}{sizes ? ` · ${sizes}` : ''}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p>No hay camisetas en esta categoría.</p>}
                </section>
              ))}
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
            <h3>Valor de ventas aprobadas</h3>
            <svg viewBox="0 0 320 140" className="dashboard-chart" role="img" aria-label="Gráfico del valor de ventas aprobadas">
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
                <h3>Cierre de ventas</h3>
                <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Consulta el valor de los pedidos aprobados por período.</p>
              </div>
            </div>
            <div className="filter-grid" style={{ marginBottom: '0.75rem' }}>
              <select value={closurePeriod} onChange={(e) => setClosurePeriod(e.target.value)}>
                <option value="day">Diario</option>
                <option value="month">Mensual</option>
                <option value="year">Anual</option>
              </select>
              {closurePeriod !== 'day' ? <input type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} /> : <span className="metric-caption">Conteo diario {dailyClosureOpen === null ? 'consultando...' : dailyClosureOpen ? 'abierto' : 'cerrado'}</span>}
            </div>
              <div className="closure-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="ghost-btn" onClick={() => loadClosureSummary(closurePeriod, closureDate)}>Ver cierre</button>
              <button className="primary-btn" onClick={createClosure} disabled={isClosing || (closurePeriod === 'day' && dailyClosureOpen !== true)}>{isClosing ? 'Generando...' : closurePeriod === 'day' ? 'Cerrar conteo y guardar' : 'Cerrar y guardar'}</button>
              {closurePeriod === 'day' && dailyClosureOpen === false ? <button className="ghost-btn" onClick={openDailyClosureCount}>Abrir conteo nuevo</button> : null}
              <button className="ghost-btn" onClick={printClosure} disabled={!closureSummary}>Imprimir</button>
            </div>
            {closureSummary ? (
              <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.6rem' }}>
                <div className="dashboard-grid dashboard-grid--wide">
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Valor vendido</h4>
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
                  {visibleClosureOrders.map((order) => (
                    <li key={order.id}><span>Pedido #{order.id}</span><strong>{formatCurrency(order.totalAmount, 'USD')}</strong></li>
                  ))}
                </ul>
                <div className="dashboard-grid dashboard-grid--wide">
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Recibido en USD</h4>
                    <p style={{ margin: 0 }}>{formatCurrency(closureSummary.paymentTotals?.USD || 0, 'USD')}</p>
                  </div>
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Recibido en Bs</h4>
                    <p style={{ margin: 0 }}>{formatCurrency(closureSummary.paymentTotals?.BS || 0, 'BS')}</p>
                  </div>
                  <div className="card" style={{ padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.25rem' }}>Equivalente recibido</h4>
                    <p style={{ margin: 0 }}>{formatCurrency(closureSummary.paymentTotals?.totalUsd || 0, 'USD')}</p>
                  </div>
                </div>
                <h4 style={{ margin: '0.5rem 0 0' }}>Abonos y saldos por pedido</h4>
                {closureSummary.payments?.length ? (
                  <div className="dashboard-ledger__scroll">
                    <table className="table">
                      <thead><tr><th>Pedido</th><th>Pago</th><th>Fecha</th><th>Recibido</th><th>Saldo restante</th></tr></thead>
                      <tbody>
                        {closureSummary.payments.map((payment, index) => (
                          <tr key={`${payment.orderId}-${payment.kind}-${index}`}>
                            <td>#{payment.orderId}</td>
                            <td>{payment.kind}</td>
                            <td>{new Date(payment.receivedAt).toLocaleString('es-VE')}</td>
                            <td>{formatCurrency(payment.amount, payment.currency)}</td>
                            <td>{formatCurrency(payment.remainingUsd, 'USD')} · {formatCurrency(payment.remainingBs, 'BS')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="metric-caption">No hubo pagos registrados en este período.</p>}
                <AdminPagination page={currentClosurePage} totalItems={closureOrders.length} onPageChange={setClosurePage} label="pedidos del cierre" />
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
              <button className="ghost-btn" type="button" onClick={downloadInventoryPdf} disabled={isDownloadingInventoryPdf}>
                {isDownloadingInventoryPdf ? 'Generando PDF...' : 'Descargar inventario PDF'}
              </button>
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
            <form ref={productFormRef} className="inventory-form" onSubmit={editingProductId ? handleUpdateProduct : handleCreateProduct}>
              <div className="filter-grid">
                <label className="inventory-field"><span>Nombre de la camiseta</span><input required placeholder="Ej. Camiseta Real Madrid" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                <label className="inventory-field"><span>Precio (USD)</span><input required type="number" min="0" step="0.01" placeholder="Ej. 25.00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
                <label className="inventory-field">
                  <span>Descuento individual (%)</span>
                  <input type="number" min="0" max="100" step="1" placeholder="0 = sin descuento" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} />
                </label>
                <label className="inventory-field"><span>Stock total</span><input type="number" min="0" placeholder="Opcional" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
                <label className="inventory-field"><span>Club o selección</span><select required value={form.club_id} onChange={(e) => setForm({ ...form, club_id: e.target.value })}>
                  <option value="">Selecciona un equipo</option>
                  {clubs.map((club) => <option key={club.id} value={club.id}>{club.category === 'selection' ? 'Selección' : 'Club'} · {club.name}</option>)}
                </select></label>
                <label className="inventory-field"><span>Tipo de camiseta</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="local">Local</option>
                  <option value="visitante">Visitante</option>
                  <option value="tercera">Tercera</option>
                </select></label>
                <label className="inventory-field"><span>Imagen principal</span><input type="url" placeholder="URL opcional" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></label>
              </div>
              <div className="filter-grid">
                {sizeOptions.map((size) => (
                  <label className="inventory-field" key={size}><span>Stock talla {size}</span><input type="number" min="0" placeholder="Unidades" value={form.stock_by_size[size]} onChange={(e) => setForm({ ...form, stock_by_size: { ...form.stock_by_size, [size]: e.target.value } })} /></label>
                ))}
              </div>
              <label className="inventory-field"><span>Más imágenes</span><input placeholder="URLs separadas por comas (opcional)" value={form.image_urls} onChange={(e) => setForm({ ...form, image_urls: e.target.value })} /></label>
              <label className="file-upload-field">
                {isUploadingProductImages ? 'Subiendo imágenes a Cloudinary...' : 'Subir imágenes desde el PC'}
                <input type="file" accept="image/*" multiple onChange={uploadProductImages} disabled={isUploadingProductImages} />
              </label>
              <label className="inventory-field"><span>Dorsales de jugadores disponibles</span><input placeholder="Ej. 10, 11, 7" value={form.dorsal_options} onChange={(e) => setForm({ ...form, dorsal_options: e.target.value })} /></label>
              <div className="inventory-options">
                <strong>Opciones que verá el cliente</strong>
                <label><input type="checkbox" checked={form.allow_no_dorsal} onChange={(e) => setForm({ ...form, allow_no_dorsal: e.target.checked })} /> Sin dorsal</label>
                <label><input type="checkbox" checked={form.allow_catalog_dorsal} onChange={(e) => setForm({ ...form, allow_catalog_dorsal: e.target.checked })} /> Dorsal de jugador</label>
                <label><input type="checkbox" checked={form.allow_custom_dorsal} onChange={(e) => setForm({ ...form, allow_custom_dorsal: e.target.checked })} /> Personalizada</label>
              </div>
              <label className="inventory-field"><span>Descripción</span><textarea rows="3" placeholder="Describe la camiseta" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#475569' }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Visible en el catálogo
              </label>
              <button className="primary-btn" type="submit">{editingProductId ? 'Actualizar camiseta' : 'Guardar camiseta'}</button>
            </form>
          ) : null}

          <div className="discount-tools">
            <div>
              <strong>Descuento general</strong>
              <p>Aplica el mismo porcentaje a todas las camisetas o retíralo con 0%.</p>
            </div>
            <div className="discount-tools__actions">
              <input type="number" min="0" max="100" step="1" value={allDiscountDraft} onChange={(event) => setAllDiscountDraft(event.target.value)} aria-label="Descuento para todo el inventario" />
              <button className="primary-btn" type="button" onClick={() => applyDiscountToAll(allDiscountDraft)}>Aplicar a todo</button>
              <button className="ghost-btn" type="button" onClick={() => { setAllDiscountDraft('0'); applyDiscountToAll(0); }}>Quitar todos</button>
            </div>
          </div>

          <div className="orders-toolbar" style={{ marginBottom: '1rem' }}>
            <input
              type="search"
              placeholder="Buscar por camiseta, club o tipo..."
              value={inventorySearch}
              onChange={(event) => {
                setInventorySearch(event.target.value);
                setInventoryPage(1);
              }}
            />
            <span className="orders-toolbar__count">{filteredInventory.length} resultado{filteredInventory.length === 1 ? '' : 's'}</span>
          </div>

          {visibleInventory.length ? (
            <table className="table" style={{ marginTop: '0.5rem' }}>
              <thead><tr><th>Camiseta</th><th>Tipo</th><th>Equipo</th><th>Stock y tallas</th><th>Precio</th><th>Acciones</th></tr></thead>
              <tbody>
                {visibleInventory.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.title}</strong></td>
                    <td>{productTypeLabels[normalizeSearchText(product.type)] || product.type || 'N/D'}</td>
                    <td>{product.club?.category === 'selection' ? 'Selección' : 'Club'} · {product.club?.name || 'Sin asignar'}</td>
                    <td><strong>{product.stock} unidades</strong><br /><small>{sizeOptions.map((size) => `${size}: ${product.stock_by_size?.[size] || 0}`).join(' · ')}</small></td>
                    <td>${Number(product.final_price ?? product.price).toFixed(2)}{Number(product.discount_percent) > 0 ? <><br /><small>Antes ${Number(product.price).toFixed(2)} (-{Number(product.discount_percent)}%)</small></> : null}</td>
                    <td className="table-actions">
                      <button className="icon-btn" onClick={() => handleEditProduct(product)} title="Editar camiseta" aria-label={`Editar camiseta ${product.title}`}>✎</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => handleDeleteProduct(product.id)} title="Eliminar camiseta" aria-label={`Eliminar camiseta ${product.title}`}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#64748b' }}>Todavía no hay camisetas registradas.</p>}
          <AdminPagination page={currentInventoryPage} totalItems={filteredInventory.length} onPageChange={setInventoryPage} label="inventario" />
        </div>
      ) : null}

      {activeView === 'stock-requests' ? (
        <div className="stock-request-module">
          <section className="card">
            <div className="stock-request-heading">
              <div>
                <p className="eyebrow">Control de mercancía</p>
                <h3>Pedidos por encargo</h3>
                <p>Registra modelos solicitados fuera de stock, las cantidades por talla y los datos del cliente. Este registro no modifica el inventario ni el estado de cuenta.</p>
              </div>
              <button className="primary-btn" type="button" onClick={() => openStockRequestEditor(null)}>＋ Apartar pedido</button>
            </div>
          </section>

          <section className="card">
            <div className="filters-card__header">
              <div>
                <h3>Solicitudes registradas</h3>
                <p>Elige fechas para filtrar la lista y generar un PDF. Sin fechas se incluyen todas.</p>
              </div>
              <button className="primary-btn" type="button" onClick={downloadStockRequestsPdf} disabled={isDownloadingStockRequests}>
                {isDownloadingStockRequests ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
            </div>
            <div className="stock-request-filters">
              <label className="inventory-field"><span>Desde</span><input type="date" value={stockRequestFrom} onChange={(event) => setStockRequestFrom(event.target.value)} /></label>
              <label className="inventory-field"><span>Hasta</span><input type="date" value={stockRequestTo} onChange={(event) => setStockRequestTo(event.target.value)} /></label>
              <button className="ghost-btn" type="button" onClick={() => { setStockRequestFrom(''); setStockRequestTo(''); }}>Ver todas</button>
              <span className="metric-caption">{stockRequests.length} solicitud(es)</span>
            </div>
            {stockRequestError ? <p className="stock-request-error" role="alert">{stockRequestError}</p> : null}
            {isLoadingStockRequests ? <p className="metric-caption">Cargando solicitudes...</p> : null}
            {!isLoadingStockRequests && stockRequests.length ? (
              <div className="stock-request-table-wrap">
                <table className="table stock-request-table">
                  <thead><tr><th>Fecha</th><th>Cliente</th><th>Modelo</th><th>Tallas y personalización</th><th>Abono</th><th>Foto</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {stockRequests.map((request) => (
                      <tr key={request.id}>
                        <td>{new Date(request.created_at).toLocaleDateString('es-VE')}</td>
                        <td><strong>{request.client_name}</strong><br /><small>{request.phone}{request.email ? ` · ${request.email}` : ''}</small></td>
                        <td>{request.model}<br /><small>{({ local: 'Local', visitante: 'Visitante', alternativa: 'Alternativa' })[request.shirt_type]}</small></td>
                        <td>
                          {Object.entries(request.size_quantities || { [request.size]: 1 }).map(([size, quantity]) => `${size}: ${quantity}`).join(' · ')}
                          <br /><small>{request.printed_details?.length
                            ? request.printed_details.map((detail) => `${detail.quantity} ${detail.size}: ${detail.printed_name} · #${detail.dorsal}`).join(' / ')
                            : 'Sin estampar'}</small>
                        </td>
                        <td>{formatCurrency(request.deposit_amount, request.deposit_currency)}</td>
                        <td>{request.image_url ? <a className="stock-request-thumbnail-link" href={assetUrl(request.image_url)} target="_blank" rel="noreferrer"><img className="stock-request-thumbnail" src={assetUrl(request.image_url)} alt={`Modelo solicitado por ${request.client_name}`} /></a> : '—'}</td>
                        <td className="table-actions">
                          <button className="icon-btn" type="button" onClick={() => openStockRequestEditor(request)} title="Editar apartado" aria-label={`Editar apartado de ${request.client_name}`}>✎</button>
                          <button className="icon-btn icon-btn--danger" type="button" onClick={() => deleteStockRequest(request)} title="Eliminar apartado" aria-label={`Eliminar apartado de ${request.client_name}`}>🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!isLoadingStockRequests && !stockRequests.length && !stockRequestError ? <p className="metric-caption">No hay pedidos por encargo en este período.</p> : null}
          </section>
        </div>
      ) : null}

      {activeView === 'content' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Contenido de la tienda</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Publica banners, imágenes o videos promocionales en el catálogo.</p>
            </div>
          </div>
          <form className="inventory-form" onSubmit={saveContent}>
            <div className="filter-grid">
              <label className="inventory-field"><span>Espacio de publicación</span><select value={contentForm.placement} onChange={(e) => {
                const placement = e.target.value;
                const isVideoPlacement = placement.startsWith('video-');
                setContentForm({ ...contentForm, placement, slot: isVideoPlacement ? 'video' : placement, type: isVideoPlacement ? 'video' : placement === 'gallery' ? 'image' : 'banner', sort_order: isVideoPlacement ? ({ 'video-left': 0, 'video-right': 1, 'video-horizontal': 2 }[placement]) : 0 });
              }}>
                <option value="banner">Banner principal · formato grande</option>
                <option value="gallery">Carrusel · fotos destacadas</option>
                <option value="video-left">Video pequeño izquierdo</option>
                <option value="video-right">Video pequeño derecho</option>
                <option value="video-horizontal">Video horizontal grande</option>
              </select></label>
              <label className="inventory-field"><span>URL del archivo multimedia</span><input required type="url" placeholder="URL directa de imagen o video" value={contentForm.media_url} onChange={(e) => setContentForm({ ...contentForm, media_url: e.target.value })} /></label>
              <label className="file-upload-field">{isUploadingContent ? 'Subiendo archivo...' : 'Subir archivo'}<input type="file" accept="image/*,video/*" onChange={uploadContentFile} disabled={isUploadingContent} /></label>
              <label className="inventory-field"><span>Título</span><input placeholder="Ej. Nueva colección" value={contentForm.title} onChange={(e) => setContentForm({ ...contentForm, title: e.target.value })} /></label>
              <label className="inventory-field"><span>Enlace de promoción</span><input placeholder="Opcional" value={contentForm.link_url} onChange={(e) => setContentForm({ ...contentForm, link_url: e.target.value })} /></label>
              {!contentForm.placement?.startsWith('video-') ? <label className="inventory-field"><span>Orden de aparición</span><input type="number" min="0" placeholder="0 = primero" value={contentForm.sort_order} onChange={(e) => setContentForm({ ...contentForm, sort_order: e.target.value })} /></label> : null}
            </div>
            {contentForm.placement?.startsWith('video-') ? <div className="content-upload-guide"><strong>Destino seleccionado</strong><span>Este archivo se guardará directamente en el espacio: {contentForm.placement === 'video-left' ? 'video pequeño izquierdo' : contentForm.placement === 'video-right' ? 'video pequeño derecho' : 'video horizontal grande'}.</span></div> : null}
            <label className="inventory-field"><span>Descripción breve</span><textarea rows="3" placeholder="Texto que acompaña el contenido" value={contentForm.description} onChange={(e) => setContentForm({ ...contentForm, description: e.target.value })} /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#475569' }}>
              <input type="checkbox" checked={contentForm.is_active} onChange={(e) => setContentForm({ ...contentForm, is_active: e.target.checked })} />
              Visible en el catálogo
            </label>
            <div className="inventory-item__actions">
              <button className="primary-btn" type="submit">{editingContentId ? 'Actualizar contenido' : 'Publicar contenido'}</button>
              {editingContentId ? <button className="ghost-btn" type="button" onClick={() => { setEditingContentId(null); setContentForm(createEmptyContentForm()); }}>Cancelar</button> : null}
            </div>
          </form>
          <div className="inventory-grid" style={{ marginTop: '1rem' }}>
            {content.length ? visibleContent.map((item) => (
              <div className="inventory-item" key={item.id}>
                <strong>{item.title || 'Contenido sin título'}</strong>
                <span>{item.slot === 'banner' ? 'Banner principal · formato grande' : item.slot === 'video' ? `Video destacado · posición ${Number(item.sort_order || 0) + 1} (${Number(item.sort_order || 0) < 2 ? 'espacio pequeño' : 'horizontal grande'})` : 'Foto del carrusel'} · {item.is_active ? 'Visible' : 'Oculto'}</span>
                <span style={{ overflowWrap: 'anywhere' }}>{item.media_url}</span>
                <div className="inventory-item__actions">
                  <button className="icon-btn" type="button" onClick={() => editContent(item)} title="Editar contenido" aria-label={`Editar ${item.title || 'contenido'}`}>✎</button>
                  <button className="icon-btn icon-btn--danger" type="button" onClick={() => removeContent(item.id)} title="Eliminar contenido" aria-label={`Eliminar ${item.title || 'contenido'}`}>🗑</button>
                </div>
              </div>
            )) : <p style={{ color: '#64748b' }}>Todavía no hay contenido publicado.</p>}
          </div>
          <AdminPagination page={currentContentPage} totalItems={content.length} onPageChange={setContentPage} label="contenido" />
        </div>
      ) : null}

      {activeView === 'clubs' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Clubes y selecciones</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Registra equipos para separar las camisetas de clubes y selecciones.</p>
            </div>
          </div>
          <form className="inventory-form" onSubmit={handleSubmitClub}>
            <div className="filter-grid">
              <input required placeholder="Nombre del club" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} />
              <input placeholder="País" value={clubForm.country} onChange={(e) => setClubForm({ ...clubForm, country: e.target.value })} />
              <input placeholder="URL del logo" value={clubForm.logo_url} onChange={(e) => setClubForm({ ...clubForm, logo_url: e.target.value })} />
              <select value={clubForm.category} onChange={(e) => setClubForm({ ...clubForm, category: e.target.value })} aria-label="Categoría del equipo">
                <option value="club">Club</option>
                <option value="selection">Selección</option>
              </select>
            </div>
            <button className="primary-btn club-form__submit" type="submit">{editingClubId ? 'Actualizar equipo' : 'Registrar equipo'}</button>
          </form>
          <div className="orders-toolbar" role="group" aria-label="Filtrar equipos por categoría">
            <button className={clubCategoryFilter === 'all' ? 'primary-btn' : 'ghost-btn'} type="button" onClick={() => { setClubCategoryFilter('all'); setClubsPage(1); }}>Todos</button>
            <button className={clubCategoryFilter === 'club' ? 'primary-btn' : 'ghost-btn'} type="button" onClick={() => { setClubCategoryFilter('club'); setClubsPage(1); }}>Clubes</button>
            <button className={clubCategoryFilter === 'selection' ? 'primary-btn' : 'ghost-btn'} type="button" onClick={() => { setClubCategoryFilter('selection'); setClubsPage(1); }}>Selecciones</button>
            <span className="orders-toolbar__count">{filteredAdminClubs.length} equipos</span>
          </div>
          {visibleClubs.length ? (
            <table className="table" style={{ marginTop: '1rem' }}>
              <thead><tr><th>Equipo</th><th>Categoría</th><th>País</th><th>Acciones</th></tr></thead>
              <tbody>
                {visibleClubs.map((club) => (
                  <tr key={club.id}>
                    <td><strong>{club.name}</strong></td>
                    <td>{club.category === 'selection' ? 'Selección' : 'Club'}</td>
                    <td>{club.country || 'Sin país'}</td>
                    <td className="table-actions">
                      <button className="icon-btn" onClick={() => handleEditClub(club)} title="Editar equipo" aria-label={`Editar ${club.name}`}>✎</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => handleDeleteClub(club.id)} title="Eliminar equipo" aria-label={`Eliminar ${club.name}`}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#64748b' }}>No hay equipos en esta categoría.</p>}
          <AdminPagination page={currentClubsPage} totalItems={filteredAdminClubs.length} onPageChange={setClubsPage} label="clubes y selecciones" />
        </div>
      ) : null}

      {activeView === 'users' ? (() => {
        const normalizedUserSearch = userSearch.trim().toLowerCase();
        const filteredUsers = users.filter((user) => [user.name, user.email, user.phone, user.role].some((value) => String(value || '').toLowerCase().includes(normalizedUserSearch)));
        const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
        const visibleUsers = filteredUsers.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE);
        return (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
              <div>
                <h3>Usuarios registrados</h3>
                <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Consulta los datos principales, pedidos y compras aprobadas.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="badge">{filteredUsers.length} usuario{filteredUsers.length === 1 ? '' : 's'}</span>
                <button className="primary-btn" type="button" onClick={startCreateUser}>Nuevo usuario</button>
              </div>
            </div>
            {editingUserId || showCreateUserForm ? (
              <form className="inventory-form" onSubmit={saveUser}>
                <div className="filter-grid">
                  <input required placeholder="Nombre completo" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
                  <input required type="email" placeholder="Correo" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
                  <input placeholder="Teléfono" value={userForm.phone} onChange={(event) => setUserForm({ ...userForm, phone: event.target.value })} />
                  {showCreateUserForm ? <input required type="password" minLength="6" placeholder="Contraseña (mínimo 6 caracteres)" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /> : null}
                  <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                    <option value="client">Cliente</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="primary-btn" type="submit">{showCreateUserForm ? 'Crear usuario' : 'Guardar cambios'}</button>
                  <button className="ghost-btn" type="button" onClick={() => { setEditingUserId(null); setShowCreateUserForm(false); }}>Cancelar</button>
                </div>
              </form>
            ) : null}
            <div className="orders-toolbar">
              <input type="search" placeholder="Buscar por nombre, correo, teléfono o rol..." value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserPage(1); }} />
              <span className="orders-toolbar__count">Página {userPage} de {totalUserPages}</span>
            </div>
            {visibleUsers.length ? (
              <table className="table">
                <thead><tr><th>Usuario</th><th>Contacto</th><th>Rol</th><th>Pedidos</th><th>Aprobado</th><th>Registro</th><th>Acciones</th></tr></thead>
                <tbody>
                  {visibleUsers.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.name}</strong><br /><small>ID #{user.id}</small></td>
                      <td>{user.email}<br /><small>{user.phone || 'Sin teléfono'}</small></td>
                      <td><span className="badge">{user.role === 'admin' ? 'Administrador' : 'Cliente'}</span></td>
                      <td>{user.orders_count}</td>
                      <td>{formatCurrency(user.approved_total, 'USD')}</td>
                      <td>{new Date(user.created_at).toLocaleDateString('es-VE')}</td>
                      <td className="table-actions"><button className="icon-btn" onClick={() => startEditUser(user)} title="Editar usuario" aria-label={`Editar usuario ${user.name}`}>✎</button> <button className="icon-btn icon-btn--danger" onClick={() => requestConfirmation('Eliminar usuario', `¿Eliminar definitivamente a ${user.name}?`, () => deleteUser(user))} title="Eliminar usuario" aria-label={`Eliminar usuario ${user.name}`}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p style={{ color: '#64748b' }}>No hay usuarios que coincidan con la búsqueda.</p>}
            {filteredUsers.length ? <div className="orders-pagination"><button className="ghost-btn" disabled={userPage === 1} onClick={() => setUserPage((current) => Math.max(1, current - 1))}>Anterior</button><span>{(userPage - 1) * USERS_PER_PAGE + 1}-{Math.min(userPage * USERS_PER_PAGE, filteredUsers.length)} de {filteredUsers.length}</span><button className="ghost-btn" disabled={userPage === totalUserPages} onClick={() => setUserPage((current) => Math.min(totalUserPages, current + 1))}>Siguiente</button></div> : null}
          </div>
        );
      })() : null}

      {activeView === 'orders' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="filters-card__header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Pedidos</h3>
              <p style={{ margin: '0.2rem 0 0', color: '#64748b' }}>Busca, filtra y administra tus pedidos desde una sola bandeja.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span className="badge">{filteredOrders.length} resultado{filteredOrders.length === 1 ? '' : 's'}</span>
              <button className="ghost-btn" type="button" onClick={() => setManualOrderOpen(true)}>＋ Nuevo pedido</button>
              <label>Desde <input type="date" value={approvedPdfFrom} max={today} onChange={(event) => setApprovedPdfFrom(event.target.value)} /></label>
              <label>Hasta <input type="date" value={approvedPdfTo} max={today} onChange={(event) => setApprovedPdfTo(event.target.value)} /></label>
              <button className="primary-btn" type="button" onClick={downloadApprovedOrders} title="Descargar pedidos aceptados del rango seleccionado">🖨️ Imprimir aceptados</button>
            </div>
          </div>
          <div className="order-filter-select">
            <label htmlFor="order-status-filter">Filtrar por estado</label>
            <select id="order-status-filter" value={orderFilter} onChange={(event) => setOrderFilterAndResetPage(event.target.value)}>
              <option value="all">Todos ({orders.length})</option>
              {orderStatusOptions.map(([value, label]) => (
                <option key={value} value={value}>{label} ({orders.filter((order) => order.status === value).length})</option>
              ))}
            </select>
            <label htmlFor="installment-payment-filter">Pago por partes</label>
            <select id="installment-payment-filter" value={installmentFilter} onChange={(event) => { setInstallmentFilter(event.target.value); setOrderPage(1); }}>
              <option value="all">Todos</option>
              <option value="pending">Falta un comprobante ({orders.filter((order) => order.payment_plan === 'installments' && Boolean(order.payment_proof_url) !== Boolean(order.delivery_payment_proof_url)).length})</option>
              <option value="completed">Dos comprobantes · pago completado ({orders.filter((order) => order.payment_plan === 'installments' && order.payment_proof_url && order.delivery_payment_proof_url).length})</option>
            </select>
          </div>
          <div className="orders-toolbar">
            <input
              type="search"
              placeholder="Buscar por ID, nombre o correo..."
              value={orderSearch}
              onChange={(event) => { setOrderSearch(event.target.value); setOrderPage(1); }}
            />
            <span className="orders-toolbar__count">Página {orderPage} de {totalOrderPages}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={allFilteredOrdersSelected} onChange={toggleAllFilteredOrders} />
              Seleccionar todos
            </label>
            {selectedOrderIds.length ? (
              <button className="icon-btn icon-btn--danger" type="button" onClick={() => requestConfirmation('Eliminar pedidos seleccionados', `¿Eliminar definitivamente ${selectedOrderIds.length} pedido(s)? Esta acción no se puede deshacer.`, deleteSelectedOrders)} title="Eliminar pedidos seleccionados" aria-label="Eliminar pedidos seleccionados">🗑</button>
            ) : null}
            {selectedOrderIds.length ? <span className="orders-toolbar__count">{selectedOrderIds.length} seleccionado(s)</span> : null}
          </div>
          {visibleOrders.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th aria-label="Seleccionar"></th>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Comprobante</th>
                  <th>Detalle</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
                  <Fragment key={order.id}>
                  <tr>
                    <td><input type="checkbox" checked={selectedOrderIds.includes(order.id)} onChange={() => toggleOrderSelection(order.id)} aria-label={`Seleccionar pedido ${order.id}`} /></td>
                    <td>#{order.id}</td>
                    <td>{order.client?.name}</td>
                    <td>
                      <div>{formatCurrency(order.total_amount, 'USD')}</div>
                      <div className="price-bs">{formatCurrency(Number(order.total_amount) * Number(order.exchange_rate || exchangeRate), 'BS')}</div>
                      {order.payment_plan === 'installments' ? (() => {
                        const payment = getInstallmentSummary(order);
                        if (payment.isComplete) return <small className="order-payment-summary order-payment-summary--complete">Pago completado</small>;
                        if (!payment.hasFirstProof) return <small className="order-payment-summary">Falta comprobante inicial</small>;
                        if (!payment.amount || payment.remainingUsd === null) return <small className="order-payment-summary">Registra el monto abonado</small>;
                        const finalCurrency = getPaymentMethodCurrency(order.payment_method);
                        const inferredFinalAmount = payment.hasFinalProof && payment.finalAmount <= 0 && payment.paidUsd !== null
                          ? Math.max(0, Number(order.total_amount || 0) - payment.paidUsd) * (finalCurrency === 'BS' ? payment.rate : 1)
                          : payment.finalAmount;
                        return <small className="order-payment-summary">Abono {formatCurrency(payment.amount, payment.currency)}{inferredFinalAmount > 0 ? ` · Pago final ${formatCurrency(inferredFinalAmount, finalCurrency)}` : ''} · Saldo {formatCurrency(payment.remainingUsd, 'USD')}{payment.remainingBs === null ? '' : ` (${formatCurrency(payment.remainingBs, 'BS')})`}</small>;
                      })() : null}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {order.payment_proof_url ? <a href={getProofUrl(order.payment_proof_url)} target="_blank" rel="noreferrer" title={order.payment_plan === 'installments' ? 'Ver comprobante del primer pago' : 'Ver comprobante del pago completo'}>{order.payment_plan === 'installments' ? '1er pago' : 'Pago completo'}</a> : null}
                        {order.delivery_payment_proof_url ? <a href={getProofUrl(order.delivery_payment_proof_url)} target="_blank" rel="noreferrer" title="Ver comprobante del pago al entregar">2do pago</a> : null}
                        {!order.payment_proof_url && !order.delivery_payment_proof_url ? <span className="badge">Sin comprobante</span> : null}
                      </div>
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => loadOrderDetail(order.id)} title={expandedOrderId === order.id ? 'Ocultar productos' : 'Ver productos'} aria-label={expandedOrderId === order.id ? `Ocultar productos del pedido ${order.id}` : `Ver productos del pedido ${order.id}`}>{expandedOrderId === order.id ? '⌃' : '⌄'}</button>
                    </td>
                    <td>
                      <button className="icon-btn" onClick={() => openOrderEdit(order.id)} title="Editar todos los datos del pedido" aria-label={`Editar todos los datos del pedido ${order.id}`}>✎</button>
                      <button className="icon-btn" onClick={() => setOrderDiscountEdit({ id: order.id, discount: order.discount_percent || 0 })} title="Aplicar descuento al pedido" aria-label={`Aplicar descuento al pedido ${order.id}`}>%</button>
                      <button className="icon-btn" onClick={() => downloadInvoice(order.id)} title="Descargar factura" aria-label={`Descargar factura del pedido ${order.id}`}>▣</button>
                      <button className="icon-btn icon-btn--danger" onClick={() => requestConfirmation('Eliminar pedido', `¿Eliminar definitivamente el pedido #${order.id}? Esta acción no se puede deshacer.`, () => deleteOrder(order.id))} title={`Eliminar pedido #${order.id}`} aria-label={`Eliminar pedido #${order.id}`}>🗑</button>
                    </td>
                  </tr>
                  {expandedOrderId === order.id && orderDetails[order.id] ? renderExpandedOrderRow(order) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#64748b' }}>No hay pedidos que coincidan con estos filtros.</p>}

          {filteredOrders.length > 0 ? (
            <div className="orders-pagination">
              <button className="ghost-btn" onClick={() => setOrderPage((current) => Math.max(1, current - 1))} disabled={orderPage === 1}>Anterior</button>
              <span>{(orderPage - 1) * ORDERS_PER_PAGE + 1}-{Math.min(orderPage * ORDERS_PER_PAGE, filteredOrders.length)} de {filteredOrders.length}</span>
              <button className="ghost-btn" onClick={() => setOrderPage((current) => Math.min(totalOrderPages, current + 1))} disabled={orderPage === totalOrderPages}>Siguiente</button>
            </div>
          ) : null}

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
              {visibleAuditLogs.map((log) => (
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
          <AdminPagination page={currentAuditPage} totalItems={auditLogs.length} onPageChange={setAuditPage} label="auditoría" />
        </div>
      ) : null}

      <Modal
        open={stockRequestModalOpen}
        title={editingStockRequestId ? 'Editar apartado' : 'Apartar pedido para cliente'}
        message={editingStockRequestId ? 'Actualiza los datos del apartado. El abono continúa separado del estado de cuenta.' : 'Completa los datos de la camiseta que debemos solicitar. El abono queda registrado por separado.'}
        className="admin-stock-request-modal"
        onClose={closeStockRequestEditor}
      >
        <form className="stock-request-form" onSubmit={saveStockRequest}>
          <div className="stock-request-form__grid">
            <label className="inventory-field">
              <span>Nombre del cliente *</span>
              <input required maxLength="150" autoComplete="name" value={stockRequestForm.client_name} onChange={(event) => setStockRequestForm((current) => ({ ...current, client_name: event.target.value }))} placeholder="Nombre y apellido" />
            </label>
            <label className="inventory-field">
              <span>Teléfono *</span>
              <input required maxLength="50" autoComplete="tel" value={stockRequestForm.phone} onChange={(event) => setStockRequestForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+58..." />
            </label>
            <label className="inventory-field stock-request-form__wide">
              <span>Correo (opcional)</span>
              <input type="email" maxLength="150" autoComplete="email" value={stockRequestForm.email} onChange={(event) => setStockRequestForm((current) => ({ ...current, email: event.target.value }))} placeholder="cliente@correo.com" />
            </label>
            <label className="inventory-field stock-request-form__wide">
              <span>Modelo de camiseta *</span>
              <input required maxLength="200" value={stockRequestForm.model} onChange={(event) => setStockRequestForm((current) => ({ ...current, model: event.target.value }))} placeholder="Ej. Real Madrid 2025/26" />
            </label>
            <label className="inventory-field">
              <span>Versión *</span>
              <select required value={stockRequestForm.shirt_type} onChange={(event) => setStockRequestForm((current) => ({ ...current, shirt_type: event.target.value }))}>
                <option value="local">Local</option>
                <option value="visitante">Visitante</option>
                <option value="alternativa">Alternativa</option>
              </select>
            </label>
            <fieldset className="stock-request-sizes stock-request-form__wide">
              <legend>Tallas y cantidades *</legend>
              <p>Indica cuántas camisetas de cada talla quiere el cliente; deja en blanco las que no necesite.</p>
              <div className="stock-request-sizes__grid">
                {sizeOptions.map((size) => (
                  <label className="inventory-field" key={size}>
                    <span>Talla {size}</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={stockRequestForm.size_quantities[size]}
                      onChange={(event) => setStockRequestForm((current) => ({
                        ...current,
                        size_quantities: { ...current.size_quantities, [size]: event.target.value }
                      }))}
                      aria-label={`Cantidad talla ${size}`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="inventory-field stock-request-form__wide">
              <span>Estampado</span>
              <select value={stockRequestForm.has_print ? 'yes' : 'no'} onChange={(event) => setStockRequestForm((current) => ({
                ...current,
                has_print: event.target.value === 'yes',
                printed_details: event.target.value === 'yes'
                  ? current.printed_details.length
                    ? current.printed_details
                    : [{
                      size: Object.entries(current.size_quantities).find(([, quantity]) => Number(quantity) > 0)?.[0] || 'S',
                      quantity: '1',
                      printed_name: '',
                      dorsal: ''
                    }]
                  : []
              }))}>
                <option value="no">Sin estampar</option>
                <option value="yes">Sí, con estampado</option>
              </select>
            </label>
            {stockRequestForm.has_print ? (
              <fieldset className="stock-request-print-details stock-request-form__wide">
                <legend>Detalles del estampado</legend>
                <p>Agrega una línea por cada combinación de talla, cantidad, nombre y dorsal.</p>
                {stockRequestForm.printed_details.map((detail, index) => (
                  <div className="stock-request-print-details__row" key={index}>
                    <label className="inventory-field">
                      <span>Talla *</span>
                      <select
                        required
                        value={detail.size}
                        onChange={(event) => setStockRequestForm((current) => ({
                          ...current,
                          printed_details: current.printed_details.map((item, itemIndex) => itemIndex === index
                            ? { ...item, size: event.target.value }
                            : item)
                        }))}
                      >
                        {sizeOptions.map((size) => <option value={size} key={size}>{size}</option>)}
                      </select>
                    </label>
                    <label className="inventory-field">
                      <span>Cantidad *</span>
                      <input
                        required
                        type="number"
                        min="1"
                        max={stockRequestForm.size_quantities[detail.size] || undefined}
                        step="1"
                        value={detail.quantity}
                        onChange={(event) => setStockRequestForm((current) => ({
                          ...current,
                          printed_details: current.printed_details.map((item, itemIndex) => itemIndex === index
                            ? { ...item, quantity: event.target.value }
                            : item)
                        }))}
                      />
                    </label>
                    <label className="inventory-field">
                      <span>Nombre *</span>
                      <input
                        required
                        maxLength="150"
                        value={detail.printed_name}
                        onChange={(event) => setStockRequestForm((current) => ({
                          ...current,
                          printed_details: current.printed_details.map((item, itemIndex) => itemIndex === index
                            ? { ...item, printed_name: event.target.value }
                            : item)
                        }))}
                        placeholder="Nombre estampado"
                      />
                    </label>
                    <label className="inventory-field">
                      <span>Dorsal *</span>
                      <input
                        required
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{1,2}"
                        maxLength="2"
                        value={detail.dorsal}
                        onChange={(event) => setStockRequestForm((current) => ({
                          ...current,
                          printed_details: current.printed_details.map((item, itemIndex) => itemIndex === index
                            ? { ...item, dorsal: event.target.value.replace(/\D/g, '').slice(0, 2) }
                            : item)
                        }))}
                        placeholder="00–99"
                      />
                    </label>
                    <button
                      className="icon-btn icon-btn--danger"
                      type="button"
                      onClick={() => setStockRequestForm((current) => ({
                        ...current,
                        printed_details: current.printed_details.filter((_, itemIndex) => itemIndex !== index),
                        has_print: current.printed_details.length > 1
                      }))}
                      aria-label={`Quitar estampado ${index + 1}`}
                      title="Quitar estampado"
                    >×</button>
                  </div>
                ))}
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => setStockRequestForm((current) => ({
                    ...current,
                    has_print: true,
                    printed_details: [...current.printed_details, {
                      size: Object.entries(current.size_quantities).find(([, quantity]) => Number(quantity) > 0)?.[0] || 'S',
                      quantity: '1',
                      printed_name: '',
                      dorsal: ''
                    }]
                  }))}
                >＋ Agregar otro estampado</button>
              </fieldset>
            ) : null}
            <label className="inventory-field">
              <span>Abono (opcional)</span>
              <input type="number" min="0" step="0.01" value={stockRequestForm.deposit_amount} onChange={(event) => setStockRequestForm((current) => ({ ...current, deposit_amount: event.target.value }))} placeholder="0.00" />
            </label>
            <label className="inventory-field">
              <span>Moneda del abono</span>
              <select value={stockRequestForm.deposit_currency} onChange={(event) => setStockRequestForm((current) => ({ ...current, deposit_currency: event.target.value }))}>
                <option value="USD">USD</option>
                <option value="BS">Bs</option>
              </select>
            </label>
            <label className="inventory-field stock-request-form__wide">
              <span>Foto del modelo (JPG/PNG, máximo 8 MB)</span>
              <input type="file" accept="image/jpeg,image/png" onChange={selectStockRequestImage} />
            </label>
            {stockRequestPreview ? (
              <div className="stock-request-form__preview-wrap">
                <img className="stock-request-form__preview" src={stockRequestPreview} alt="Vista previa del modelo solicitado" />
                <button className="ghost-btn" type="button" onClick={() => {
                  setStockRequestForm((current) => ({
                    ...current,
                    model_image: null,
                    image_url: '',
                    remove_image: Boolean(editingStockRequestId && current.image_url)
                  }));
                  setStockRequestPreview('');
                }}>Quitar foto</button>
              </div>
            ) : null}
            <label className="inventory-field stock-request-form__wide">
              <span>Notas (opcional)</span>
              <textarea rows="2" maxLength="1000" value={stockRequestForm.notes} onChange={(event) => setStockRequestForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalles adicionales del pedido" />
            </label>
          </div>
          {stockRequestError ? <p className="stock-request-error" role="alert">{stockRequestError}</p> : null}
          <div className="stock-request-form__actions">
            <button className="ghost-btn" type="button" onClick={closeStockRequestEditor} disabled={isSavingStockRequest}>Cancelar</button>
            <button className="primary-btn" type="submit" disabled={isSavingStockRequest}>{isSavingStockRequest ? 'Guardando...' : editingStockRequestId ? 'Guardar cambios' : 'Guardar apartado'}</button>
          </div>
        </form>
      </Modal>
      <Modal
        open={manualOrderOpen}
        title="Crear pedido manual"
        message="Completa los datos del cliente y agrega los productos para registrar un pedido desde el panel administrativo."
        className="admin-order-modal"
        onClose={closeManualOrder}
        onConfirm={continueManualOrder}
        confirmLabel={manualOrderStep === 3 ? 'Crear pedido' : 'Continuar'}
      >
        <div className="admin-order-wizard">
          <ol className="admin-order-steps" aria-label="Pasos para crear el pedido">
            {['Cliente', 'Productos', 'Pago'].map((label, index) => (
              <li className={manualOrderStep === index + 1 ? 'admin-order-steps__item is-active' : manualOrderStep > index + 1 ? 'admin-order-steps__item is-complete' : 'admin-order-steps__item'} key={label}>
                <span>{index + 1}</span><small>{label}</small>
              </li>
            ))}
          </ol>
          {manualOrderError ? <p className="admin-order-error" role="alert">{manualOrderError}</p> : null}

          {manualOrderStep === 1 ? <section className="admin-order-step-panel">
            <div className="order-edit-form__grid">
              <label><span>Nombre del cliente</span><input value={manualOrderForm.client.name} onChange={(event) => setManualOrderForm((current) => ({ ...current, client: { ...current.client, name: event.target.value } }))} placeholder="Nombre completo" /></label>
              <label><span>Correo</span><input type="email" value={manualOrderForm.client.email} onChange={(event) => setManualOrderForm((current) => ({ ...current, client: { ...current.client, email: event.target.value } }))} placeholder="cliente@email.com" /></label>
              <label><span>Teléfono</span><input value={manualOrderForm.client.phone} onChange={(event) => setManualOrderForm((current) => ({ ...current, client: { ...current.client, phone: event.target.value } }))} placeholder="+58..." /></label>
              <label><span>Estado del pedido</span><select value={manualOrderForm.status} onChange={(event) => setManualOrderForm((current) => ({ ...current, status: event.target.value }))}>{orderStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="order-edit-form__wide"><span>Entrega</span><select value={manualOrderForm.delivery_method} onChange={(event) => setManualOrderForm((current) => ({ ...current, delivery_method: event.target.value }))}><option value="personal">Entrega personal</option><option value="national">Envío nacional</option></select></label>
            </div>
            {manualOrderForm.delivery_method === 'national' ? (
              <fieldset className="shipping-form order-edit-form__shipping">
                <legend>Datos de envío</legend>
                <input placeholder="Nombre y apellido" value={manualOrderForm.shipping_details.name} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, name: event.target.value } }))} />
                <div className="shipping-form__row"><input placeholder="Teléfono" value={manualOrderForm.shipping_details.phone} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, phone: event.target.value } }))} /><input placeholder="Cédula" value={manualOrderForm.shipping_details.cedula} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, cedula: event.target.value } }))} /></div>
                <input placeholder="Agencia de envío" value={manualOrderForm.shipping_details.agency} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, agency: event.target.value } }))} />
                <div className="shipping-form__row"><input placeholder="Estado" value={manualOrderForm.shipping_details.state} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, state: event.target.value } }))} /><input placeholder="Ciudad" value={manualOrderForm.shipping_details.city} onChange={(event) => setManualOrderForm((current) => ({ ...current, shipping_details: { ...current.shipping_details, city: event.target.value } }))} /></div>
              </fieldset>
            ) : <p className="delivery-summary">Entrega personal en San Cristóbal</p>}
          </section> : null}

          {manualOrderStep === 2 ? <section className="admin-order-step-panel">
          <div className="order-item-editor order-item-editor--modal">
            <select value={manualOrderItemForm.product_id} onChange={async (event) => {
              const productId = event.target.value;
              const product = inventory.find((item) => Number(item.id) === Number(productId));
              setManualOrderItemForm((current) => ({ ...current, product_id: productId, size: '', dorsalMode: product?.allow_no_dorsal !== false ? 'none' : '', dorsalId: '', customName: '', customNumber: '' }));
              if (productId) {
                const response = await fetch(apiUrl(`/api/products/${productId}`));
                const data = await response.json().catch(() => ({}));
                const dorsals = data.dorsals || [];
                setManualOrderDorsals(dorsals);
                const dorsalMode = product?.allow_no_dorsal !== false
                  ? 'none'
                  : product?.allow_catalog_dorsal !== false && dorsals.some((item) => item.is_available)
                    ? 'catalog'
                    : product?.allow_custom_dorsal !== false ? 'custom' : '';
                setManualOrderItemForm((current) => ({ ...current, dorsalMode }));
              } else {
                setManualOrderDorsals([]);
              }
            }} aria-label="Producto para pedido manual">
              <option value="">Selecciona una camiseta</option>
              {inventory.filter((product) => Number(product.stock) > 0 || Number(product.id) === Number(manualOrderItemForm.product_id)).map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
            </select>
            <div className="order-item-editor__fields">
              <select value={manualOrderItemForm.size} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, size: event.target.value }))} aria-label="Talla para pedido manual">
                <option value="">Talla</option>
                {(() => {
                  const product = inventory.find((item) => Number(item.id) === Number(manualOrderItemForm.product_id));
                  if (!product) return null;
                  return sizeOptions.filter((size) => getManualOrderAvailableStock(product, size) > 0).map((size) => <option key={size} value={size}>{size} · {getManualOrderAvailableStock(product, size)} disponibles</option>);
                })()}
              </select>
              <input type="number" min="1" max={manualOrderItemForm.size ? Math.min(10, getManualOrderAvailableStock(inventory.find((item) => Number(item.id) === Number(manualOrderItemForm.product_id)), manualOrderItemForm.size)) : 10} value={manualOrderItemForm.quantity} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, quantity: Number(event.target.value) || 1 }))} aria-label="Cantidad para pedido manual" />
            </div>
            {(() => {
              const product = inventory.find((item) => Number(item.id) === Number(manualOrderItemForm.product_id));
              const dorsalModes = [
                { value: 'none', label: 'Sin dorsal', allowed: product?.allow_no_dorsal !== false },
                { value: 'catalog', label: 'Dorsal de jugador', allowed: product?.allow_catalog_dorsal !== false && manualOrderDorsals.some((item) => item.is_available) },
                { value: 'custom', label: 'Camiseta personalizada', allowed: product?.allow_custom_dorsal !== false }
              ].filter((mode) => mode.allowed);
              return (
                <select value={manualOrderItemForm.dorsalMode} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, dorsalMode: event.target.value, dorsalId: '', customName: '', customNumber: '' }))} aria-label="Tipo de dorsal para pedido manual" disabled={!product || dorsalModes.length === 0}>
                  {dorsalModes.length ? dorsalModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>) : <option value="">Sin modalidades de dorsal configuradas</option>}
                </select>
              );
            })()}
            {manualOrderItemForm.dorsalMode === 'catalog' ? (
              <select value={manualOrderItemForm.dorsalId} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, dorsalId: event.target.value }))} aria-label="Dorsal de jugador para pedido manual">
                <option value="">Selecciona dorsal *</option>
                {manualOrderDorsals.filter((item) => item.is_available).map((item) => <option key={item.id} value={item.id}>{item.dorsal_number} - {item.player_name || 'Disponible'}</option>)}
              </select>
            ) : null}
            {manualOrderItemForm.dorsalMode === 'custom' ? (
              <div className="order-item-editor__fields order-item-editor__custom-fields">
                <input placeholder="Nombre para la camiseta" value={manualOrderItemForm.customName} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, customName: event.target.value }))} />
                <input placeholder="Número para la camiseta" inputMode="numeric" value={manualOrderItemForm.customNumber} onChange={(event) => setManualOrderItemForm((current) => ({ ...current, customNumber: event.target.value }))} />
              </div>
            ) : null}
            <button type="button" className="ghost-btn" onClick={addManualOrderItem}>Agregar producto</button>
          </div>
          {manualOrderForm.items.length ? (
            <div className="admin-order-items-summary">
              <h4>En este pedido <span>{manualOrderForm.items.length}</span></h4>
              <ul className="dashboard-list">
                {manualOrderForm.items.map((item, index) => (
                  <li key={`${item.product_id}-${item.size}-${index}`}>
                    <span>{item.title || `Producto #${item.product_id}`} · Talla {item.size} · {item.quantity} und.</span>
                    <button type="button" className="icon-btn icon-btn--danger" onClick={() => removeManualOrderItem(item.product_id, item.size)} aria-label={`Eliminar ${item.title || 'producto'} del pedido manual`}>🗑</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          </section> : null}

          {manualOrderStep === 3 ? <section className="admin-order-step-panel">
            <div className="order-edit-form__grid">
              <label><span>Método de pago</span><select value={manualOrderForm.payment_method} onChange={(event) => setManualOrderForm((current) => changePaymentMethod(current, event.target.value, exchangeRate))}><option value="pago_movil">Pago Móvil</option><option value="binance">Binance</option><option value="efectivo">Efectivo</option></select></label>
              <label><span>Forma de pago</span><select value={manualOrderForm.payment_plan} onChange={(event) => setManualOrderForm((current) => ({ ...current, payment_plan: event.target.value, delivery_payment_proof: event.target.value === 'full' ? null : current.delivery_payment_proof }))}><option value="full">Pago completo</option><option value="installments">Pago por partes</option></select></label>
            </div>
            <div className="admin-order-proof-fields">
              {manualOrderForm.payment_plan === 'installments' ? <p className="admin-order-payment-note">Primer pago del 50% para confirmar y 50% restante al entregar.</p> : null}
              {manualOrderForm.payment_plan === 'full' ? <label><span>Monto recibido ({getPaymentMethodCurrency(manualOrderForm.payment_method)})</span><input type="text" inputMode="decimal" value={manualOrderForm.full_payment_amount} onChange={(event) => setManualOrderForm((current) => ({ ...current, full_payment_amount: event.target.value }))} placeholder="12.187,50" /></label> : null}
              {manualOrderForm.payment_plan === 'installments' ? <div className="admin-order-amount-fields"><label><span>Moneda del primer abono</span><select value={manualOrderForm.first_payment_currency} onChange={(event) => setManualOrderForm((current) => changeFirstPaymentCurrency(current, event.target.value, exchangeRate))}><option value="USD">USD</option><option value="BS">Bs</option></select></label><label><span>Primer abono recibido ({manualOrderForm.first_payment_currency})</span><input type="text" inputMode="decimal" value={manualOrderForm.first_payment_amount} onChange={(event) => setManualOrderForm((current) => ({ ...current, first_payment_amount: event.target.value }))} placeholder="12.187,50" /></label><span className="metric-caption">Elige la moneda en que recibiste este abono.</span></div> : null}
              <label className="admin-order-file"><span>{manualOrderForm.payment_plan === 'full' ? 'Comprobante del pago completo' : 'Comprobante del primer pago · 50%'}</span><input type="file" accept="image/*" disabled={uploadingOrderProof === 'manual:first_payment_proof'} onChange={(event) => uploadAdminOrderProof(event, 'manual', 'first_payment_proof')} />{uploadingOrderProof === 'manual:first_payment_proof' ? <small>Subiendo a Cloudinary...</small> : null}{manualOrderForm.first_payment_proof ? <a className="admin-order-current-proof" href={getProofUrl(manualOrderForm.first_payment_proof)} target="_blank" rel="noreferrer">{manualOrderForm.first_payment_proof}</a> : null}</label>
              {manualOrderForm.payment_plan === 'installments' ? <>
                <label><span>Moneda del segundo pago</span><select value={manualOrderForm.delivery_payment_currency} onChange={(event) => setManualOrderForm((current) => changeDeliveryPaymentCurrency(current, event.target.value, exchangeRate))}><option value="USD">USD</option><option value="BS">Bs</option></select></label>
                <label><span>Segundo pago recibido ({manualOrderForm.delivery_payment_currency})</span><input type="text" inputMode="decimal" value={manualOrderForm.delivery_payment_amount} onChange={(event) => setManualOrderForm((current) => ({ ...current, delivery_payment_amount: event.target.value }))} placeholder="12.187,50" /></label>
                <label className="admin-order-file"><span>Comprobante del pago final</span><input type="file" accept="image/*" disabled={uploadingOrderProof === 'manual:delivery_payment_proof'} onChange={(event) => uploadAdminOrderProof(event, 'manual', 'delivery_payment_proof')} /><small>Puedes adjuntarlo ahora o agregarlo al editar el pedido después de la entrega.</small>{uploadingOrderProof === 'manual:delivery_payment_proof' ? <small>Subiendo a Cloudinary...</small> : null}{manualOrderForm.delivery_payment_proof ? <a className="admin-order-current-proof" href={getProofUrl(manualOrderForm.delivery_payment_proof)} target="_blank" rel="noreferrer">{manualOrderForm.delivery_payment_proof}</a> : null}</label>
              </> : null}
            </div>
          </section> : null}
          <div className="admin-order-wizard__back">
            {manualOrderStep > 1 ? <button className="ghost-btn" type="button" onClick={() => { setManualOrderError(''); setManualOrderStep((step) => step - 1); }}>Volver</button> : <span />}
            <span>Paso {manualOrderStep} de 3</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(orderEdit)}
        title={`Editar pedido #${orderEdit?.id || ''}`}
        message="Modifica los datos del pedido y guarda los cambios."
        onClose={() => setOrderEdit(null)}
        onConfirm={saveOrderEdit}
        confirmLabel="Guardar cambios"
      >
        {orderEdit ? (
          <div className="order-edit-form">
            <div className="order-edit-form__grid">
              <label><span>Estado</span><select value={orderEdit.status} onChange={(event) => setOrderEdit((current) => ({ ...current, status: event.target.value }))}>{orderStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Método de pago</span><select value={orderEdit.payment_method} onChange={(event) => setOrderEdit((current) => changePaymentMethod(current, event.target.value, current.exchange_rate || exchangeRate))}><option value="pago_movil">Pago Móvil</option><option value="binance">Binance</option><option value="efectivo">Efectivo</option></select></label>
              <label><span>Modalidad de entrega</span><select value={orderEdit.delivery_method} onChange={(event) => setOrderEdit((current) => ({ ...current, delivery_method: event.target.value }))}><option value="personal">Entrega personal</option><option value="national">Envío nacional</option></select></label>
              <label><span>Forma de pago</span><select value={orderEdit.payment_plan} onChange={(event) => setOrderEdit((current) => ({ ...current, payment_plan: event.target.value }))}><option value="full">Pago completo</option><option value="installments">Pago por partes</option></select></label>
            </div>
            <div className="admin-order-proof-fields">
              {orderEdit.payment_plan === 'installments' ? <p className="admin-order-payment-note">Primer pago del 50% para confirmar y 50% restante al entregar.</p> : null}
              {orderEdit.payment_plan === 'full' ? <label><span>Monto recibido ({getPaymentMethodCurrency(orderEdit.payment_method)})</span><input type="text" inputMode="decimal" value={orderEdit.full_payment_amount} onChange={(event) => setOrderEdit((current) => ({ ...current, full_payment_amount: event.target.value }))} placeholder="12.187,50" /></label> : null}
              {orderEdit.payment_plan === 'installments' ? <div className="admin-order-amount-fields"><label><span>Moneda del primer abono</span><select value={orderEdit.first_payment_currency} onChange={(event) => setOrderEdit((current) => changeFirstPaymentCurrency(current, event.target.value, current.exchange_rate || exchangeRate))}><option value="USD">USD</option><option value="BS">Bs</option></select></label><label><span>Primer abono recibido ({orderEdit.first_payment_currency})</span><input type="text" inputMode="decimal" value={orderEdit.first_payment_amount} onChange={(event) => setOrderEdit((current) => ({ ...current, first_payment_amount: event.target.value }))} placeholder="12.187,50" /></label><span className="metric-caption">Elige la moneda en que recibiste este abono.</span></div> : null}
              {orderEdit.payment_proof_url ? <a className="admin-order-current-proof" href={getProofUrl(orderEdit.payment_proof_url)} target="_blank" rel="noreferrer">Ver comprobante actual del primer pago</a> : null}
              <label className="admin-order-file"><span>{orderEdit.payment_plan === 'full' ? 'Reemplazar comprobante del pago completo' : 'Reemplazar comprobante del primer pago · 50%'}</span><input type="file" accept="image/*" disabled={uploadingOrderProof === 'edit:payment_proof_url'} onChange={(event) => uploadAdminOrderProof(event, 'edit', 'payment_proof_url')} />{uploadingOrderProof === 'edit:payment_proof_url' ? <small>Subiendo a Cloudinary...</small> : null}{orderEdit.payment_proof_url ? <a className="admin-order-current-proof" href={getProofUrl(orderEdit.payment_proof_url)} target="_blank" rel="noreferrer">{orderEdit.payment_proof_url}</a> : null}</label>
              {orderEdit.payment_plan === 'installments' ? <>
                <label><span>Moneda del segundo pago</span><select value={orderEdit.delivery_payment_currency} onChange={(event) => setOrderEdit((current) => changeDeliveryPaymentCurrency(current, event.target.value, current.exchange_rate || exchangeRate))}><option value="USD">USD</option><option value="BS">Bs</option></select></label>
                <label><span>Segundo pago recibido ({orderEdit.delivery_payment_currency})</span><input type="text" inputMode="decimal" value={orderEdit.delivery_payment_amount} onChange={(event) => setOrderEdit((current) => ({ ...current, delivery_payment_amount: event.target.value }))} placeholder="12.187,50" /></label>
                <label className="admin-order-file"><span>Comprobante del pago final</span><input type="file" accept="image/*" disabled={uploadingOrderProof === 'edit:delivery_payment_proof_url'} onChange={(event) => uploadAdminOrderProof(event, 'edit', 'delivery_payment_proof_url')} />{uploadingOrderProof === 'edit:delivery_payment_proof_url' ? <small>Subiendo a Cloudinary...</small> : null}{orderEdit.delivery_payment_proof_url ? <a className="admin-order-current-proof" href={getProofUrl(orderEdit.delivery_payment_proof_url)} target="_blank" rel="noreferrer">{orderEdit.delivery_payment_proof_url}</a> : null}</label>
              </> : null}
            </div>
            {orderEdit.delivery_method === 'national' ? (
              <fieldset className="shipping-form order-edit-form__shipping">
                <legend>Datos de envío nacional</legend>
                <input placeholder="Nombre y apellido" value={orderEdit.shipping_details.name} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, name: event.target.value } }))} />
                <input placeholder="Teléfono" value={orderEdit.shipping_details.phone} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, phone: event.target.value } }))} />
                <input placeholder="Cédula" value={orderEdit.shipping_details.cedula} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, cedula: event.target.value } }))} />
                <input placeholder="Agencia de envío" value={orderEdit.shipping_details.agency} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, agency: event.target.value } }))} />
                <div className="shipping-form__row"><input placeholder="Estado" value={orderEdit.shipping_details.state} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, state: event.target.value } }))} /><input placeholder="Ciudad" value={orderEdit.shipping_details.city} onChange={(event) => setOrderEdit((current) => ({ ...current, shipping_details: { ...current.shipping_details, city: event.target.value } }))} /></div>
              </fieldset>
            ) : <p className="delivery-summary">Entrega personal en San Cristóbal</p>}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(orderDiscountEdit)}
        title={`Descuento para pedido #${orderDiscountEdit?.id || ''}`}
        message="Aplica un descuento únicamente a este pedido. Usa 0% para quitarlo."
        onClose={() => setOrderDiscountEdit(null)}
        onConfirm={saveOrderDiscount}
        confirmLabel="Guardar descuento"
      >
        <label className="discount-field discount-field--modal">
          <span>Porcentaje de descuento</span>
          <input type="number" min="0" max="100" step="1" value={orderDiscountEdit?.discount ?? 0} onChange={(event) => setOrderDiscountEdit((current) => ({ ...current, discount: event.target.value }))} autoFocus />
        </label>
      </Modal>
      <Modal
        open={Boolean(editingOrderItems)}
        title={`${editingOrderItemId ? 'Editar producto' : 'Agregar producto'} al pedido #${editingOrderItems || ''}`}
        message={editingOrderItemId ? 'Cambia la talla o la configuración del dorsal y guarda los cambios.' : 'Selecciona la camiseta, talla y configuración del dorsal. El producto se sumará al pedido actual.'}
        onClose={() => { setEditingOrderItems(false); setEditingOrderItemId(null); }}
        onConfirm={() => saveOrderItem(editingOrderItems)}
        confirmLabel={editingOrderItemId ? 'Guardar cambios' : 'Agregar al pedido'}
      >
        <div className="order-item-editor order-item-editor--modal">
          <select value={orderItemForm.product_id} onChange={async (event) => {
            const product = inventory.find((item) => item.id === Number(event.target.value));
            const firstSize = Object.keys(product?.stock_by_size || {}).find((size) => Number(product.stock_by_size[size]) > 0) || '';
            setOrderItemForm((current) => ({ ...current, product_id: event.target.value, size: firstSize, dorsalMode: 'none', dorsalId: '', customName: '', customNumber: '' }));
            if (product?.id) {
              const response = await fetch(apiUrl(`/api/products/${product.id}`));
              const data = await response.json().catch(() => ({}));
              setOrderItemDorsals(data.dorsals || []);
            } else {
              setOrderItemDorsals([]);
            }
          }} aria-label={editingOrderItemId ? 'Producto del pedido' : 'Producto nuevo'}>
            <option value="">Selecciona una camiseta</option>
            {inventory.filter((product) => Number(product.stock) > 0 || product.id === Number(orderItemForm.product_id)).map((product) => <option key={product.id} value={product.id}>{product.title} · {formatCurrency(product.final_price ?? product.price, 'USD')}</option>)}
          </select>
          <div className="order-item-editor__fields">
            <select value={orderItemForm.size} onChange={(event) => setOrderItemForm((current) => ({ ...current, size: event.target.value }))} aria-label="Talla nueva">
              <option value="">Talla</option>
              {(inventory.find((product) => product.id === Number(orderItemForm.product_id))?.stock_by_size ? Object.entries(inventory.find((product) => product.id === Number(orderItemForm.product_id)).stock_by_size).filter(([size, stock]) => Number(stock) > 0 || size === orderItemForm.size).map(([size]) => <option key={size} value={size}>{size}</option>) : null)}
            </select>
            <input type="number" min="1" max="10" value={orderItemForm.quantity} onChange={(event) => setOrderItemForm((current) => ({ ...current, quantity: event.target.value }))} aria-label="Cantidad nueva" />
          </div>
          <select value={orderItemForm.dorsalMode} onChange={(event) => setOrderItemForm((current) => ({ ...current, dorsalMode: event.target.value, dorsalId: '', customName: '', customNumber: '' }))} aria-label="Tipo de dorsal">
            <option value="none">Sin dorsal</option>
            <option value="catalog">Dorsal de jugador</option>
            <option value="custom">Camiseta personalizada</option>
          </select>
          {orderItemForm.dorsalMode === 'catalog' ? (
            <select value={orderItemForm.dorsalId} onChange={(event) => setOrderItemForm((current) => ({ ...current, dorsalId: event.target.value }))} aria-label="Dorsal de jugador">
              <option value="">Selecciona dorsal *</option>
              {orderItemDorsals.filter((item) => item.is_available).map((item) => <option key={item.id} value={item.id}>{item.dorsal_number} - {item.player_name || 'Disponible'}</option>)}
            </select>
          ) : null}
          {orderItemForm.dorsalMode === 'custom' ? (
            <div className="order-item-editor__fields order-item-editor__custom-fields">
              <input placeholder="Nombre para la camiseta" value={orderItemForm.customName} onChange={(event) => setOrderItemForm((current) => ({ ...current, customName: event.target.value }))} />
              <input placeholder="Número para la camiseta" inputMode="numeric" value={orderItemForm.customNumber} onChange={(event) => setOrderItemForm((current) => ({ ...current, customNumber: event.target.value }))} />
            </div>
          ) : null}
        </div>
      </Modal>
      <Modal open={Boolean(activeLog)} title="Detalle del cambio" onClose={() => setActiveLog(null)}>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{activeLog ? JSON.stringify(activeLog.changes, null, 2) : ''}</pre>
      </Modal>
      <Modal
        open={Boolean(confirmation)}
        title={confirmation?.title}
        message={confirmation?.message}
        tone="danger"
        onClose={() => setConfirmation(null)}
        onConfirm={confirmAction}
        confirmLabel="Confirmar"
      />
    </div>
  );
};

export default AdminPage;
