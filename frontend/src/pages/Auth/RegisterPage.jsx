import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PropagateLoader } from "react-spinners";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import { FaRegEye } from "react-icons/fa";
import { IoMdEyeOff } from "react-icons/io";
import { MdAccountCircle, MdEmail } from "react-icons/md";
import { FaPhone } from "react-icons/fa6";
import api from "../../api/client/apiClient";

const schema = z
  .object({
    userName: z.string().min(1, "User name is required"),
    mobile: z.string().regex(/^\d{10}$/, "Mobile number must be 10 digits"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
        "Password must contain uppercase, lowercase, number and special character",
      ),
    confirmPassword: z.string().min(1, "Confirm your password"),
    terms: z.literal(true, {
      errorMap: () => ({ message: "You must accept the terms" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Password and Confirm Password do not match",
  });

const RegisterPage = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loader, setLoader] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      terms: false,
    },
  });

  const onSubmit = async (values) => {
    setLoader(true);

    const formData = {
      userName: values.userName,
      mobileNumber: values.mobile,
      email: values.email,
      password: values.password,
      confirmPassword: values.confirmPassword,
    };

    try {
      const res = await api.post("/auth/register", formData);

      setTimeout(() => {
        setLoader(false);
        toast.success(res.data.message || "Registered successfully");
        reset();
        navigate(ROUTES.login);
      }, 600);
    } catch (error) {
      setTimeout(() => {
        const msg =
          error?.response?.data?.message ||
          error.message ||
          "Registration failed";
        toast.error(msg);
        setLoader(false);
      }, 600);
    }
  };

  return (
    <div className="font-[sans-serif] bg-white md:h-screen p-5 w-full">
      <div className="flex items-center justify-center">
        <div className="flex items-center p-6 h-full w-full md:w-1/3 shadow-2xl">
          <form
            className="max-w-lg w-full mx-auto"
            onSubmit={handleSubmit(onSubmit)}
          >
            <div className="mb-12 flex flex-col items-center justify-center gap-2">
              <MdAccountCircle size={40} className="text-purple-500" />
              <h3 className="text-gray-600 md:text-xl text-lg text-center font-extrabold">
                Create an account
              </h3>
            </div>

            {/* User name */}
            <div>
              <label className="text-gray-800 text-sm block mb-2 text-left">
                User Name
              </label>
              <div className="relative flex items-center">
                <input
                  data-testid="userName-input"
                  type="text"
                  className="w-full bg-transparent text-sm border-b border-gray-300 focus:border-blue-500 px-2 py-3 outline-none"
                  placeholder="Enter user name"
                  {...register("userName")}
                />
                <MdAccountCircle className="w-[18px] h-[18px] absolute right-2 text-gray-400" />
              </div>
              {errors.userName && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.userName.message}
                </p>
              )}
            </div>

            {/* Mobile */}
            <div className="mt-6">
              <label className="text-gray-800 text-sm block mb-2 text-left">
                Mobile Number
              </label>
              <div className="relative flex items-center">
                <input
                  data-testid="mobile-input"
                  type="tel"
                  className="w-full bg-transparent text-sm border-b border-gray-300 focus:border-blue-500 px-2 py-3 outline-none"
                  placeholder="Enter mobile number"
                  {...register("mobile")}
                />
                <FaPhone className="absolute right-2 text-gray-400" />
              </div>
              {errors.mobile && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.mobile.message}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="mt-6">
              <label className="text-gray-800 text-sm block mb-2 text-left">
                Email
              </label>
              <div className="relative flex items-center">
                <input
                  data-testid="email-input"
                  type="email"
                  className="w-full bg-transparent text-sm border-b border-gray-300 focus:border-blue-500 px-2 py-3 outline-none"
                  placeholder="Enter email"
                  {...register("email")}
                />
                <MdEmail className="absolute right-2 text-gray-400" />
              </div>
              {errors.email && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="mt-6">
              <label className="text-gray-800 text-sm block mb-2 text-left">
                Password
              </label>
              <div className="relative flex items-center">
                <input
                  data-testid="password-input"
                  type={showPassword ? "text" : "password"}
                  className="w-full bg-transparent text-sm border-b border-gray-300 focus:border-blue-500 px-2 py-3 outline-none"
                  placeholder="Enter password"
                  {...register("password")}
                />
                {showPassword ? (
                  <IoMdEyeOff
                    className="w-[18px] h-[18px] absolute right-2 cursor-pointer text-gray-400"
                    onClick={() => setShowPassword((v) => !v)}
                  />
                ) : (
                  <FaRegEye
                    className="w-[18px] h-[18px] absolute right-2 cursor-pointer text-gray-400"
                    onClick={() => setShowPassword((v) => !v)}
                  />
                )}
              </div>
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="mt-6">
              <label className="text-gray-800 text-sm block mb-2 text-left">
                Confirm Password
              </label>
              <div className="relative flex items-center">
                <input
                  data-testid="confirmPassword-input"
                  type={showConfirmPassword ? "text" : "password"}
                  className="w-full bg-transparent text-sm border-b border-gray-300 focus:border-blue-500 px-2 py-3 outline-none"
                  placeholder="Confirm password"
                  {...register("confirmPassword")}
                />
                {showConfirmPassword ? (
                  <IoMdEyeOff
                    className="w-[18px] h-[18px] absolute right-2 cursor-pointer text-gray-400"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                  />
                ) : (
                  <FaRegEye
                    className="w-[18px] h-[18px] absolute right-2 cursor-pointer text-gray-400"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                  />
                )}
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            {/* Terms */}
            <div className="flex items-center mt-6">
              <input
                data-testid="terms-checkbox"
                id="terms"
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded"
                {...register("terms")}
              />
              <label
                htmlFor="terms"
                className="ml-3 block text-sm text-gray-800"
              >
                I accept the{" "}
                <Link
                  to="/terms"
                  className="text-blue-500 font-semibold hover:underline ml-1"
                >
                  Terms and Conditions
                </Link>
              </label>
            </div>
            {errors.terms && (
              <p className="text-xs text-red-500 mt-1">
                {errors.terms.message}
              </p>
            )}

            {/* Submit */}
            <div className="mt-12">
              <button
                data-testid="register-submit"
                type="submit"
                className="w-full py-3 px-6 text-sm tracking-wider font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={loader}
              >
                {loader ? (
                  <PropagateLoader color="#ffffff" size={10} className="mb-2" />
                ) : (
                  "Create an account"
                )}
              </button>
              <p className="text-sm mt-6 text-gray-800">
                Already have an account?{" "}
                <Link
                  to={ROUTES.login}
                  className="text-blue-500 font-semibold hover:underline ml-1"
                >
                  Login here
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
