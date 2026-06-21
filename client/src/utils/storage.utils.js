export const saveToLocalStorage = (key, value) => {
  localStorage.setItem(key, value);
  return true;
};

export const getFromLocalStorage = (key) => {
  const value = localStorage.getItem(key);
  return value ? value : null;
};

export const removeFromLocalStorage = (key) => {
  localStorage.removeItem(key);
  return true;
};

export const clearLocalStorage = () => {
  localStorage.clear();
  return true;
};

export const saveToSessionStorage = (key, value) => {
  sessionStorage.setItem(key, JSON.stringify(value));
  return true;
};

export const getFromSessionStorage = (key) => {
  const value = sessionStorage.getItem(key);
  return value ? JSON.parse(value) : null;
};

export const removeFromSessionStorage = (key) => {
  sessionStorage.removeItem(key);
  return true;
};

export const clearSessionStorage = () => {
  sessionStorage.clear();
  return true;
};
