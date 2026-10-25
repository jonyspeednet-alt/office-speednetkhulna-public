import React from "react";
import { Link } from "react-router-dom";
import BrandLogo from "../components/BrandLogo";
import "../styles/Login.css";

const ForgotPassword = () => {
  return (
    <div className="login-container">
      <div className="login-card text-center animate-fade-in-up">
        <BrandLogo className="logo" alt="Speed Net Khulna" />
        <div
          style={{
            background: "#fff8e1",
            border: "1px solid #ffc107",
            borderRadius: "12px",
            padding: "1.25rem",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔐</div>
          <h5
            style={{
              fontWeight: 700,
              color: "#343a40",
              marginBottom: "0.5rem",
            }}
          >
            Password Reset
          </h5>
          <p
            style={{
              color: "#6c757d",
              fontSize: "0.9rem",
              marginBottom: "1rem",
            }}
          >
            You cannot reset it by yourself if you forget it.
          </p>
          <p
            style={{
              color: "#495057",
              fontSize: "0.88rem",
              marginBottom: "0.5rem",
            }}
          >
            To change your password, please contact your <strong>System Administrator</strong>.
          </p>
          <div
            style={{
              background: "#e8f4fd",
              borderRadius: "8px",
              padding: "0.75rem",
              display: "inline-block",
              fontSize: "0.85rem",
              color: "#0d6efd",
              fontWeight: 600,
            }}
          >
            <i className="fas fa-phone me-2"></i>Speed Net IT Department
          </div>
        </div>

        <div className="alert alert-info py-2 small rounded-3 text-start mb-3">
          <i className="fas fa-lightbulb me-2 text-warning"></i>
          <strong>Tip:</strong> If you still remember your old password,
          you can change it yourself from the Profile page.
        </div>

        <Link to="/login" className="btn btn-primary w-100 mb-3">
          <i className="fas fa-arrow-left me-2"></i>Back to Login page
        </Link>

        <p className="mt-2 small text-muted">&copy; 2026 Speed Net Khulna</p>
      </div>
    </div>
  );
};

export default ForgotPassword;
