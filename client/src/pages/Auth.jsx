import React, { useState, useContext, useCallback } from "react";
import { UserContext } from "../context/UserContext";
import {
  FaEnvelope,
  FaLock,
  FaUser,
  FaSignInAlt,
  FaUserPlus,
  FaEye,
  FaEyeSlash,
  FaMountain,
} from "react-icons/fa";

const InputField = ({ icon: Icon, type, name, id, placeholder, value, onChange }) => {
  const [inputType, setInputType] = useState(type);
  const toggleVisibility = () => {
    setInputType((prevType) => (prevType === "password" ? "text" : "password"));
  };
  const isPassword = type === "password";

  return (
    <div className="relative mb-4">
      <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" size={15} />
      <input
        type={inputType}
        name={name}
        id={id}
        required
        placeholder={placeholder}
        onChange={onChange}
        value={value}
        className="w-full pl-11 pr-11 py-3 border border-border bg-canvas rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent text-ink placeholder-ink-faint transition"
      />
      {isPassword && (
        <button
          type="button"
          onClick={toggleVisibility}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition"
          aria-label={inputType === "password" ? "Show password" : "Hide password"}
        >
          {inputType === "password" ? <FaEye size={14} /> : <FaEyeSlash size={14} />}
        </button>
      )}
    </div>
  );
};

const Auth = () => {
  const { register, login, loading } = useContext(UserContext);

  const authTypes = { LOGIN: "login", REGISTER: "register" };
  const [authType, setAuthType] = useState(authTypes.LOGIN);
  const [formData, setFormData] = useState({
    fullName: { firstName: "", lastName: "" },
    email: "",
    password: "",
  });

  const updateValues = useCallback((e) => {
    const { value, name, id } = e.target;
    setFormData((prev) => {
      if (name === "fullName") {
        return { ...prev, [name]: { ...prev[name], [id]: value } };
      }
      return { ...prev, [name]: value };
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (authType === authTypes.REGISTER) {
        await register(formData);
      } else {
        const { fullName, ...rest } = formData;
        await login(rest);
      }
    } catch (error) {
      console.error("Auth Error:", error);
    }
  };

  const toggleAuthType = () => {
    setAuthType((prevType) =>
      prevType === authTypes.LOGIN ? authTypes.REGISTER : authTypes.LOGIN
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
      {/* Subtle radial accent glow behind the card for depth without clutter */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(600px circle at 50% 15%, rgba(250,204,21,0.07), transparent 70%)",
        }}
      />

      <div className="relative bg-surface border border-border p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex flex-col items-center mb-7">
          <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mb-3">
            <FaMountain className="text-accent-ink" size={20} />
          </div>
          <h2 className="font-display text-2xl font-bold text-ink text-center">
            {authType === authTypes.LOGIN ? "Welcome back" : "Create your account"}
          </h2>
          <p className="text-ink-muted text-sm mt-1 text-center">
            {authType === authTypes.LOGIN
              ? "Sign in to track your next trail"
              : "Start recording your hikes in minutes"}
          </p>
        </div>

        <form onSubmit={handleSubmit} key={authType}>
          {authType === authTypes.REGISTER && (
            <div className="flex gap-3">
              <div className="flex-1">
                <InputField
                  icon={FaUser}
                  type="text"
                  name="fullName"
                  id="firstName"
                  placeholder="First name"
                  onChange={updateValues}
                  value={formData.fullName.firstName}
                />
              </div>
              <div className="flex-1">
                <InputField
                  icon={FaUser}
                  type="text"
                  name="fullName"
                  id="lastName"
                  placeholder="Last name"
                  onChange={updateValues}
                  value={formData.fullName.lastName}
                />
              </div>
            </div>
          )}

          <InputField
            icon={FaEnvelope}
            type="email"
            name="email"
            id="email"
            placeholder="Email address"
            onChange={updateValues}
            value={formData.email}
          />

          <InputField
            icon={FaLock}
            type="password"
            name="password"
            id="password"
            placeholder="Password"
            onChange={updateValues}
            value={formData.password}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 mt-2 py-3 bg-accent hover:bg-accent-hover text-accent-ink font-semibold rounded-xl shadow-lg shadow-accent/10 transition disabled:opacity-50 active:scale-[0.99]"
          >
            {authType === authTypes.LOGIN ? <FaSignInAlt size={14} /> : <FaUserPlus size={14} />}
            {loading ? "Please wait..." : authType === authTypes.LOGIN ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={toggleAuthType}
            className="text-ink-muted hover:text-accent transition text-sm"
          >
            {authType === authTypes.LOGIN
              ? "Don't have an account? "
              : "Already have an account? "}
            <span className="text-accent font-medium">
              {authType === authTypes.LOGIN ? "Sign up" : "Sign in"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
