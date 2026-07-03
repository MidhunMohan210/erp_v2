

// controllers/voucherSeriesController.js
import Receipt from "../Model/Receipt.js";
import SaleOrder from "../Model/SaleOrder.js";
import VoucherSeries from "../Model/VoucherSeriesSchema.js";
import { resolveCompanyScope } from "../utils/companyScope.js";

export const getSeriesByVoucher = async (req, res) => {
  try {
    const { voucherType } = req.query;
    const { cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });

    if (!voucherType || !cmp_id) {
      return res
        .status(400)
        .json({ message: "voucherType and cmp_id are required" });
    }

    const seriesDoc = await VoucherSeries.findOne({
      voucherType: voucherType === "sale" ? "sales" : voucherType,
      cmp_id,
    }).lean();

    if (!seriesDoc) {
      return res
        .status(404)
        .json({ message: "No series found for this voucher type" });
    }

    // seriesDoc._id is the VoucherSeries document id (e.g. 69b1055e2a47bb531f77a46d)
    // seriesDoc.series is your array of series
    return res.status(200).json({
      voucherSeriesId: seriesDoc._id,
      series: seriesDoc.series,
    });
  } catch (error) {
    console.error("Error fetching series:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};




export const createVoucherSeries = async (req, res) => {
  try {
    const { cmp_id, Primary_user_id: primary_user_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const {
      voucherType,
      seriesName,
      prefix = "",
      suffix = "",
      currentNumber = 1,
      widthOfNumericalPart,
      isDefault = false,
      under = "",
    } = req.body;

    if (!voucherType || !seriesName || !widthOfNumericalPart) {
      return res.status(400).json({
        message: "voucherType, seriesName and widthOfNumericalPart are required",
      });
    }

    const normalizedVoucherType =
      voucherType === "sale" ? "sales" : voucherType;

    const newSeries = {
      seriesName,
      prefix,
      suffix,
      currentNumber,
      widthOfNumericalPart,
      isDefault,
      currentlySelected: false,
      lastUsedNumber: currentNumber,
      under,
    };

    const voucherSeriesDoc = await VoucherSeries.findOneAndUpdate(
      {
        cmp_id,
        voucherType: normalizedVoucherType,
      },
      {
        $setOnInsert: {
          primary_user_id,
          cmp_id,
          voucherType: normalizedVoucherType,
        },
        $push: {
          series: newSeries,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
      }
    ).lean();

    return res.status(201).json({
      message: "Voucher series created successfully",
      voucherSeriesId: voucherSeriesDoc._id,
      series: voucherSeriesDoc.series,
    });
  } catch (error) {
    console.error("Error creating voucher series:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};


export const updateVoucherSeries = async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const {
      voucherType,
      seriesName,
      prefix = "",
      suffix = "",
      // currentNumber,  // ⬅ remove from destructuring
      widthOfNumericalPart,
    } = req.body;

    if (!voucherType || !seriesName || !widthOfNumericalPart) {
      return res.status(400).json({
        message: "voucherType, seriesName and widthOfNumericalPart are required",
      });
    }

    const normalizedVoucherType =
      voucherType === "sale" ? "sales" : voucherType;

    const doc = await VoucherSeries.findOneAndUpdate(
      {
        cmp_id,
        voucherType: normalizedVoucherType,
        "series._id": seriesId,
      },
      {
        $set: {
          "series.$.seriesName": seriesName,
          "series.$.prefix": prefix,
          "series.$.suffix": suffix,
          "series.$.widthOfNumericalPart": widthOfNumericalPart,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    return res.status(200).json({
      message: "Voucher series updated successfully",
      voucherSeriesId: doc._id,
      series: doc.series,
    });
  } catch (error) {
    console.error("Error updating voucher series:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};



export const deleteVoucherSeriesById = async (req, res) => {
  try {
    const { cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const { voucherType } = req.body;
    const seriesId = req.params.seriesId || req.body?.seriesId;

    if (!voucherType || !seriesId) {
      return res
        .status(400)
        .json({ message: "voucherType and seriesId are required" });
    }

    const normalizedVoucherType =
      voucherType === "sale" ? "sales" : voucherType;

    const [saleOrderUsingSeries, receiptUsingSeries] = await Promise.all([
      SaleOrder.findOne({ cmp_id, series_id: seriesId }).select("_id").lean(),
      Receipt.findOne({ cmp_id, series_id: seriesId }).select("_id").lean(),
    ]);

    if (saleOrderUsingSeries || receiptUsingSeries) {
      return res.status(400).json({
        message: "Series is already used in a sale order or receipt",
      });
    }

    const result = await VoucherSeries.findOneAndUpdate(
      {
        cmp_id,
        voucherType: normalizedVoucherType,
      },
      {
        $pull: { series: { _id: seriesId } },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return res
        .status(404)
        .json({ message: "Voucher series document not found" });
    }

    return res.status(200).json({
      message: "Series deleted successfully",
      voucherSeriesId: result._id,
      series: result.series,
    });
  } catch (error) {
    console.error("Error deleting voucher series:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};


// controller: getNextVoucherSeriesNumber
export const getNextVoucherSeriesNumber = async (req, res) => {
  try {
    const { cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const { voucherType } = req.query;

    if (!cmp_id || !voucherType) {
      return res.status(400).json({
        message: "cmp_id and voucherType are required",
      });
    }

    return res.status(200).json({
      nextCurrentNumber: 1,
    });
  } catch (error) {
    console.error("Error getting next voucher series number:", error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};

