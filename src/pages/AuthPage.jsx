import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '../api';
import Modal from '../components/Modal';

const AuthPage = ({ onAuth }) => {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [message, setMessage] = useState('');
  const [errorModal, setErrorModal] = useState(null);
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    const endpoint = mode === 'login'
      ? apiUrl('/api/auth/login')
      : mode === 'register' ? apiUrl('/api/auth/register') : apiUrl('/api/auth/forgot-password');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) {
      setErrorModal({ title: 'No se pudo continuar', message: data.error || 'Ocurrió un error.' });
      return;
    }
    if (mode === 'forgot') {
      setMessage(data.message);
      setMode('login');
      setForm({ name: '', email: form.email, phone: '', password: '' });
      return;
    }
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    onAuth(data.user);
    navigate('/');
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {mode !== 'forgot' ? (
          <div className="auth-toggle">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(''); }}>Iniciar sesión</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setMessage(''); }}>Registrarse</button>
          </div>
        ) : null}
        <h2>{mode === 'login' ? 'Bienvenido de nuevo' : mode === 'register' ? 'Crea tu cuenta' : 'Recupera tu contraseña'}</h2>
        <p>{mode === 'login' ? 'Accede para seguir tu compra y ver tus pedidos.' : mode === 'register' ? 'Únete a SportWear Club y compra tus camisetas favoritas.' : 'Verifica tu correo y teléfono registrados para crear una nueva contraseña.'}</p>
        {message ? <p className="auth-message">{message}</p> : null}
        <form className="form" onSubmit={submit}>
          {mode === 'register' ? (
            <>
              <input placeholder="Nombre completo" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Teléfono" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </>
          ) : null}
          <input type="email" placeholder="Correo electrónico" onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {mode === 'forgot' ? <input placeholder="Teléfono registrado" onChange={(e) => setForm({ ...form, phone: e.target.value })} /> : null}
          <input type="password" placeholder="Contraseña" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {mode !== 'forgot' ? <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setMessage(''); setForm({ name: '', email: '', phone: '', password: '' }); }}>¿Olvidaste tu contraseña?</button> : null}
          <button className="submit-btn" type="submit">{mode === 'login' ? 'Ingresar' : mode === 'register' ? 'Crear cuenta' : 'Cambiar contraseña'}</button>
        </form>
        {mode === 'forgot' ? <button type="button" className="auth-link" onClick={() => { setMode('login'); setMessage(''); }}>Volver a iniciar sesión</button> : null}
      </div>
      <Modal open={Boolean(errorModal)} title={errorModal?.title} message={errorModal?.message} onClose={() => setErrorModal(null)} />
    </div>
  );
};

export default AuthPage;
