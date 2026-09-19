const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export const apiFetch = async (path, options = {}) => {
	const response = await fetch(apiUrl(path), options);
	if (response.status === 401) {
		window.dispatchEvent(new CustomEvent('session-expired'));
	}
	return response;
};

export const assetUrl = (value) => {
	if (!value) return '';
	if (/^https?:\/\//i.test(value)) return value;
	return apiUrl(value);
};

export default API_BASE_URL;
