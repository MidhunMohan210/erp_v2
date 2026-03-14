import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import { PropagateLoader } from "react-spinners";
import { MdEmail } from "react-icons/md";
import { FaPhone } from "react-icons/fa6";
import { FaRegEye } from "react-icons/fa";
import { IoMdEyeOff } from "react-icons/io";
import { useLoginUser } from "../../hooks/mutations/useLoginUser";

const schema = z.object({
  identifier: z.string().min(1, "Email or Phone is required").trim(),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});

const LoginPage = () => {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { loginUser, loading } = useLoginUser();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      identifier: "",
      password: "",
      rememberMe: false,
    },
  });

  const onSubmit = async (values) => {
    try {
      // controller uses: const { identifier, password } = req.body;
      const payload = {
        identifier: values.identifier, // email or mobile
        password: values.password,
      };

      await loginUser(payload);

      navigate(ROUTES.home, { replace: true });
    } catch {
      // error toast already shown in hook
    }
  };

  return (
    <div className="font-[sans-serif] bg-[#f5f7fb] min-h-screen flex items-center justify-center p-4 w-full">
      <div className="w-full max-w-md">
        <div className="bg-white shadow-xl rounded-xl px-8 py-10">
          {/* top icon + welcome text */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-full bg-[#2563eb] flex items-center justify-center mb-4">
              <span className="text-white text-2xl font-bold">{">"}</span>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900">Welcome!</h2>
            <p className="text-sm text-gray-500">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Email or phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email or Phone
              </label>
              <div className="relative">
                <input
                  data-testid="identifier-input"
                  type="text"
                  placeholder="Enter Email or Phone"
                  className="w-full border border-gray-300 rounded-md py-2.5 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  {...register("identifier")}
                />
                <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">
                  <MdEmail className="hidden sm:block" />
                  <FaPhone className="sm:hidden" />
                </span>
              </div>
              {errors.identifier && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.identifier.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  data-testid="password-input"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  className="w-full border border-gray-300 rounded-md py-2.5 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  {...register("password")}
                />
                <span
                  className="absolute inset-y-0 right-3 flex items-center text-gray-400 cursor-pointer"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <IoMdEyeOff className="w-4 h-4" />
                  ) : (
                    <FaRegEye className="w-4 h-4" />
                  )}
                </span>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* remember + forgot */}
            <div className="flex items-center justify-between text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  data-testid="rememberMe-checkbox"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  {...register("rememberMe")}
                />
                <span className="text-gray-700">Remember me</span>
              </label>
              <button
                type="button"
                className="text-blue-600 font-medium hover:underline"
              >
                Forgot your password?
              </button>
            </div>

            {/* submit */}
            <div className="pt-2">
              <button
                data-testid="login-submit"
                type="submit"
                className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold py-2.5 rounded-md text-sm flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? (
                  <PropagateLoader
                    color="#ffffff"
                    size={8}
                    className="translate-y-[1px]"
                  />
                ) : (
                  "Sign in"
                )}
              </button>
            </div>
          </form>

          {/* bottom register link */}
          <p className="mt-6 text-center text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link
              to={ROUTES.register}
              className="text-blue-600 font-semibold hover:underline"
            >
              Register here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
