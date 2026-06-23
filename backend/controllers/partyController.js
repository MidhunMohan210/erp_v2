import {
  addParty as addPartyService,
  deleteParty as deletePartyService,
  getPartyById as getPartyByIdService,
  listParties as listPartiesService,
  updateParty as updatePartyService,
} from "../services/party.service.js";

export const addParty = async (req, res) => {
  try {
    const result = await addPartyService(
      {
        ...req.body,
        cmp_id: req.companyId,
      },
      req
    );

    return res.status(201).json({
      success: true,
      message: "Party added successfully",
      party: result,
    });
   } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("addParty error:", error);
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Internal server error, try again!",
    });
  }
};

export const listParties = async (req, res) => {
  try {
    const result = await listPartiesService(req.query || {}, req);
    return res.json(result);
  } catch (err) {
    console.error("listParties error:", err);
    return res
      .status(err.statusCode || 500)
      .json({ message: err.statusCode ? err.message : "Failed to fetch parties" });
  }
};

export const getPartyById = async (req, res) => {
  try {
    const { id } = req.params;
    const party = await getPartyByIdService(id, req);
    res.json(party);
  } catch (error) {
    console.error("getPartyById error:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Failed to fetch party" });
  }
};

export const updateParty = async (req, res) => {
  try {
    const { id } = req.params;
    const party = await updatePartyService(id, req.body || {}, req);

    res.json({ message: "Party updated", party });
  } catch (error) {
    console.error("updateParty error:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Failed to update party" });
  }
};

export const deleteParty = async (req, res) => {
  try {
    const { id } = req.params;
    await deletePartyService(id, req);

    res.json({ message: "Party deleted" });
  } catch (error) {
    console.error("deleteParty error:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Failed to delete party" });
  }
};

