import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthPage = ({ onAuth }) => {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) return alert(data.error || 'Error');
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    onAuth(data.user);
    navigate('/');
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-toggle">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Iniciar sesión</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Registrarse</button>
        </div>
        <h2>{mode === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}</h2>
        <p>{mode === 'login' ? 'Accede para seguir tu compra y ver tus pedidos.' : 'Únete a SportWear Club y compra tus camisetas favoritas.'}</p>
        <form className="form" onSubmit={submit}>
          {mode === 'register' ? (
            <>
              <input placeholder="Nombre completo" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Teléfono" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </>
          ) : null}
          <input type="email" placeholder="Correo electrónico" onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input type="password" placeholder="Contraseña" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button className="submit-btn" type="submit">{mode === 'login' ? 'Ingresar' : 'Crear cuenta'}</button>
        </form>
      </div>
    </div>
  );
};

export default AuthPage;
