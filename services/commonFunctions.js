import bcrypt from 'bcrypt';
import * as Jwt from 'jsonwebtoken';
import moment from 'moment';
import Twilio from 'twilio';
import { User, Message, settingSchema, ClinicPatient, locationSchema } from '../models';
import format from 'string-format';
import DBoperations from './DBoperations';
import logger from './logger';
import sgMail from '@sendgrid/mail';
import * as jotform from 'jotform';
import _ from 'underscore';
import * as fs from 'fs';
import * as mime from 'mime';

import * as PDFDocument from 'html-pdf';
import axios from "axios";

import * as dotenv from 'dotenv';
var mongoose = require('mongoose');
dotenv.config();

if (!process.env.SENDGRID_API_KEY) {
    throw new Error('Missing enviornment variable: SENDGRID_API_KEY');
}
if (!process.env.SENDGRID_MAIL_FROM) {
    throw new Error('Missing enviornment variable: SENDGRID_MAIL_FROM');
}
if (!process.env.WEBSITE_URL) {
    throw new Error('Missing enviornment variable: WEBSITE_URL');
}

if (!process.env.JOT_FORM_KEY) {
    throw new Error('Missing enviornment variable: JOT_FORM_KEY');
}
if (!process.env.JOT_FORM_URL) {
    throw new Error('Missing enviornment variable: JOT_FORM_URL');
}

if (!process.env.BITLY_URL || !process.env.BITLY_TOKEN) {
    throw new Error("Missing bitly configure in env file : BITLY_URL OR BITLY_TOKEN");
}


jotform.options({
    url: process.env.JOT_FORM_URL,
    debug: true,
    apiKey: process.env.JOT_FORM_KEY
});

const jotformField_needToCheck = ['insuranceCardUpdate']

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

let compareHashPassword = async (plainTextPassword, hash) => {
    try {
        return bcrypt.compareSync(plainTextPassword, hash)
    } catch (error) {
        console.log(error)
        return ''
    }
}
let createHash = async (plainText) => {
    try {
        return bcrypt.hashSync(plainText, 10)
    } catch (error) {
        console.log(error)
        return ''
    }
}
const setToken = async function (tokenData) {
    return new Promise((resolve, reject) => {
        try {
            console.log('\n tokenData:', tokenData)
            if (!tokenData.id || !tokenData.type) {
                throw new Error(getErrorMessage("jwtError"));
            }
            let tokenToSend = Jwt.sign(tokenData, process.env.JWT_SECRET_KEY);
            return resolve({ accessToken: tokenToSend });
        } catch (err) {
            return reject(err);
        }
    })
};
const verifyToken = async function (token) {
    return new Promise(async (resolve, reject) => {
        try {
            var decoded = Jwt.verify(token, process.env.JWT_SECRET_KEY);
            return resolve(decoded);
        } catch (err) {
            err.status = 401;
            (err.message && err.message === 'jwt malformed') ? err.message = getErrorMessage("unAuth") : err;
            return reject(err);
        }
    })
}

const getReplyMessage = (type, count = 0, totalCount = 0, businessName = '', userName = '', timer = 0, jotformUrl = '') => {
    try {
        const replyMessages = {
            no_respond: "We are experiencing a problem with our system. Please retry in a few minutes.",
            help: 'Keywords available: "Cancel Appointment" to cancel your place in line, DELAY to notify you will be late, ARRIVED to notify arrival, BLOCK to block, UNBLOCK to unblock, CHANGE to change your name, STATUS for most updated line position',
            change: 'Please text us your first and last name (e.g. Jane Doe).',
            block: `Your number has been blocked for further SMS from ${businessName}. Reply UNBLOCK to unblock it.`,
            alreadyBlock: `Your number is blocked for further SMS from ${businessName}. Please Reply UNBLOCK to unblock it.`,
            unblock: 'Your number has been unblocked. Reply BLOCK to block further SMS',
            cancel: 'You have removed your place in line.',
            delay: 'Your provider has been notified that you will be late.',
            status: `Your line position is [${count} of ${totalCount}]`,
            no_match: 'Keywords available: "Cancel Appointment" to cancel your place in line, DELAY to notify you will be late, ARRIVED to notify arrival, BLOCK to block, UNBLOCK to unblock, CHANGE to change your name, STATUS for most updated line position',
            waiting_new: `Hi. Welcome to ${businessName}. You are now checked in. Your line position is [${count} of ${totalCount}]. Text "STATUS" anytime for updated line position. It looks like we don't have your name in our database. Please text us your first and last time (e.g. Jane Doe).`,
            waiting_existing: `Hi  ${userName}. Welcome to ${businessName}. You are now checked in. Your line position is [${count} of ${totalCount}]. Text "STATUS" anytime for updated line position. We will text you when its your turn. In the meantime, you can relax in your car.`,
            waiting_new_withoutLinePosition: `Hi. Welcome to ${businessName}. You are now checked in. Text "STATUS" anytime for updated line position. It looks like we don't have your name in our database. Please text us your first and last time (e.g. Jane Doe).`,
            waiting_existing_withoutLinePosition: `Hi  ${userName}. Welcome to ${businessName}. You are now checked in. Text "STATUS" anytime for updated line position. We will text you when its your turn. In the meantime, you can relax in your car.`,
            update_name: `Hi ${userName}, Thank you for giving us your name. If there is a misspelling, you can text "CHANGE" to change or correct your name anytime.`,
            getSpotNo: `If you are in a designated parking spot, please text us the spot number (e.g. 1, 2, 3, 4). If there is no spot number, you can just stay put.`,
            checkIn: `We are now ready to see you. Please proceed to the check-in area and your name will be called shortly.`,
            checkOut: `Hi ${userName}! Thanks you,  You're checked out of ${businessName}. Out of a scale from 1-10, how likely would you recommend ${businessName} to a friend.`,
            nextInLine: `You are next in line. We will text you when to come in.`,
            timerMessage: `Your wait is about ${timer} minutes. We will text you when to come in.`,
            already_checkIn: `You have already check In for the day. Use keywords: status or "help me" for more Information`,
            noShowAlert: `receptionist/provider mark you as "no show"`,
            submit_form_with_yes: `${userName}, thank you for signing in to ${businessName}. You are now in line. You will get a text when we are ready to see you.`,
            submit_form_with_no: `${userName}, thank you for signing in to ${businessName}. We first need you to complete your paperwork so we can place you in line. After you complete your paperwork, you will get a text when we are ready to see you. Complete your paperwork by clicking here: ${jotformUrl}`,
            not_submit_paperwork: `${userName}, we have not received your registeration paperwork. Please click on this link to fill in your paperwork ${jotformUrl}`,
            submit_paperwork: `${userName}, thank you for completing your paperwork. you will get a text if we have any other question or when we are ready to see you.`,
            reviewMessage: `Hi ${userName}! , We would appreciate it if you can let us know, how we could have improved your experience : ${jotformUrl}`,
            customReview: `Hi ${userName}! , Thank you please write us a review. ${jotformUrl}`,
            empty: `You have send a empty message. Please write something So that,we can find what you want.`
        }

        return replyMessages[type];
    } catch (err) {
        console.log('\n error in getReplyMessage:', err.message || err);
        return 'Keywords available: ARRIVED to check-IN for the day, CANCEL to cancel your place in line, DELAY to notify you will be late, ARRIVED to notify arrival, BLOCK to block, UNBLOCK to unblock, CHANGE to change your name, STATUS for most updated line position';
    }
}
const getErrorMessage = (type) => {
    try {
        const errors = {
            missingAuth: 'Header parameter is Missing: Authorization',
            missingLocation: 'Header parameter is Missing: LocationId',
            unAuth: 'unauthorized',
            jwtError: 'During generate token found that, Id or Type is missing into payload.',
            somethingWrongElse: 'Something went wrong into our system. We will get back to you soonest.',
            somethingWrong: 'Something went wrong into Our System.Please contact to admin.',
            clinicNotExist: 'Clinic for provided Contact No. not exist into Our System.',
            patientIdNotExist: 'Please provide patient Id.',
            clinicIdNotExist: 'Please provide clinic Id',
            patientNotFound: 'No Data Available into Our system for provided Patient Id',
            clinicNotFound: 'No Data Available into Our System for Provided Clinic location',
            clinicContactNotFound: 'No Messages number allocated to provided Clinic location Id',
            typeInToken: 'Type from auth token not found. Please check that your token is valid.',
            parkingSpotError: 'You have replied a wrong message for parking spot',
            locationUnauth: 'No Data found for LocationId'
        }
        return errors[type];
    } catch (err) {
        return 'Something went wrong into Our System.Please contact to admin.';
    }
}
const getUTCStartEndOfTheDay = () => {
    return new Promise(async (resolve, reject) => {
        try {
            var start = moment.utc().tz('America/New_York').startOf('day');
            var end = moment.utc().tz('America/New_York').endOf('day');
            return resolve({ start: start, end: end });
        } catch (err) {
            return reject(err);
        }
    })
}
const checkUserInformation = (userData) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!userData || !userData.id) {
                throw { status: 400, message: getErrorMessage('clinicIdNotExist') };
            }
            if (!userData.type) {
                throw { status: 400, message: getErrorMessage('typeInToken') }
            }
            return resolve(true);
        } catch (err) {
            return reject(err);
        }
    })
}
const getSuccessMessage = (type) => {
    try {
        const success = {
            GET: 'Fetch Data Successfully.',
            POST: 'Insert Data Successfully.',
            PUT: 'Update Data Successfully',
            LOGIN: 'Login Successfully',
            FORGOT: 'Please check you mail box.',
            RESET_PASSWORD: 'Password update Successfully.',
            REMOVE_PATIENT: 'Patient profile remove successfully'
        }
        return success[type];
    } catch (err) {
        return 'Data Fetch Successfully.';
    }
}
const sendTwilioMessage = async (payloadData) => {
    try {
        const state = await new Promise(async (resolve, reject) => {
            try {
                const twillioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                twillioClient.messages.create({
                    to: payloadData.to,
                    from: payloadData.from,
                    body: payloadData?.body || undefined,
                    mediaUrl: payloadData?.mediaUrl || undefined,
                })
                    .then(message => {
                        console.log("send twilio message:", message.sid);
                        return resolve(message);
                    })
                    .catch((error) => {
                        console.log("\n error in twilio message send:", error.message || error);
                        return reject(error);
                    });
            } catch (err) {
                return reject(err);
            }
        });
        console.log("\n on complete twilio send sms...");
        return Promise.resolve(state);
    } catch (error_1) {
        console.log("\n on error in twilio send sms...", error_1.message || error_1);
        return Promise.reject(error_1);
    }
}
const checkSettingAndUpdateMessage = (checkFor, clinicId, patientData, locationId, jotFormUrl = "") => {
    return new Promise(async (resolve, reject) => {
        try {
            const [clinicSetting, baseUrl] = await Promise.all([
                DBoperations.findOne(settingSchema, { clinicId: clinicId }, {}, {}),
                commonFunctions.getEnvVariable('WEBSITE_URL')
            ])
            const { count, totalCount } = await getCountForWaitingList(clinicId, patientData._id, locationId);
            const firstName = (patientData && patientData.first_name) ? patientData.first_name : '';
            const lastName = (patientData && patientData.last_name) ? patientData.last_name : '';
            const placeHolderValues = {
                order: count,
                totalOrder: totalCount,
                name: firstName + ' ' + lastName,
                business: (clinicSetting && clinicSetting.businessInformation && clinicSetting.businessInformation.companyName) ? clinicSetting.businessInformation.companyName : "Our business",
                reviewLink: `${baseUrl}/review/${locationId}/${patientData._id}`,
                clinicNumber: (clinicSetting && clinicSetting.businessInformation && clinicSetting.businessInformation.companyNumber) ? clinicSetting.businessInformation.companyNumber : "Our office number",
                jotUrl: jotFormUrl
            }
            if (clinicSetting) {
                switch (checkFor) {
                    case 'confirmationAlert':
                        if (clinicSetting.confirmationAlert && clinicSetting.confirmationAlert.is_active && clinicSetting.confirmationAlert.message) {
                            const replacedMessage = format(clinicSetting.confirmationAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'checkInAlert':
                        if (clinicSetting.checkInAlert && clinicSetting.checkInAlert.is_active && clinicSetting.checkInAlert.message) {
                            const replacedMessage = format(clinicSetting.checkInAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'checkOutAlert':
                        if (clinicSetting.checkOutAlert && clinicSetting.checkOutAlert.is_active && clinicSetting.checkOutAlert.message) {
                            const replacedMessage = format(clinicSetting.checkOutAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'noShowAlert':
                        if (clinicSetting.noShowAlert && clinicSetting.noShowAlert.is_active && clinicSetting.noShowAlert.message) {
                            const replacedMessage = format(clinicSetting.noShowAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'parkingSpotAlert':
                        if (clinicSetting.parkingSpotAlert && clinicSetting.parkingSpotAlert.is_active && clinicSetting.parkingSpotAlert.message) {
                            const replacedMessage = format(clinicSetting.parkingSpotAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'confirmationAlertNew':
                        if (clinicSetting.confirmationAlert && clinicSetting.confirmationAlert.is_active && clinicSetting.confirmationAlert.new_message) {
                            const replacedMessage = format(clinicSetting.confirmationAlert.new_message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'companyOffAlert':
                        if (clinicSetting.companyOffAlert && clinicSetting.companyOffAlert.is_active && clinicSetting.companyOffAlert.message) {
                            const replacedMessage = format(clinicSetting.companyOffAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'reviewLinkAlert':
                        if (clinicSetting.reviewLinkAlert && clinicSetting.reviewLinkAlert.is_active && clinicSetting.reviewLinkAlert.message) {
                            const replacedMessage = format(clinicSetting.reviewLinkAlert.message, placeHolderValues)
                            return resolve({ status: true, message: replacedMessage, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    case 'providerNotAtDeskAlert':
                        if (clinicSetting.providerNotAtDeskAlert && clinicSetting.providerNotAtDeskAlert.is_active) {
                            let replacedMessage = `Please call our office number at : ${placeHolderValues.clinicNumber}`;
                            const certainTime = clinicSetting.providerNotAtDeskAlert.certainTime || 15;
                            if (clinicSetting.providerNotAtDeskAlert.message) {
                                replacedMessage = format(clinicSetting.providerNotAtDeskAlert.message, placeHolderValues)
                            }
                            return resolve({ status: true, message: replacedMessage, certainTime: certainTime, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        } else {
                            return resolve({ status: false, message: null, certainTime: 0, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                        }
                    default:
                        return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
                }
            } else {
                return resolve({ status: false, message: null, count: count, totalCount: totalCount, businessName: placeHolderValues.business });
            }
        } catch (err) {
            return reject(err);
        }
    })
}

const getCountForWaitingList = (clinicId = null, patientId = null, locationId = null) => {
    return new Promise(async (resolve) => {
        try {
            if (!clinicId || !patientId || !locationId) {
                return resolve({ count: 0, totalCount: 0 });
            }
            const { start, end } = await getUTCStartEndOfTheDay();
            const payloadClinicPatient = {
                clinicId: clinicId,
                locationId: locationId,
                visitDate: { $gte: new Date(start), $lte: new Date(end) },
                is_block: false,
                isCancel: false,
                is_delete: { $ne: true },
                inQueue: true
            }
            const existClinicPatient = await DBoperations.getData(ClinicPatient, payloadClinicPatient, { _id: 1, patientId: 1, clinicId: 1 }, { lean: true }, []);
            let count = 0;
            if (existClinicPatient && existClinicPatient.length > 0) {
                for (let i = 0; i < existClinicPatient.length; i++) {
                    if (existClinicPatient[i].patientId.toString() == patientId.toString()) {
                        count = i + 1;
                        break;
                    }
                }
            }
            const totalWaiting = await DBoperations.count(ClinicPatient, payloadClinicPatient);
            return resolve({ count: count, totalCount: (totalWaiting && totalWaiting > 0) ? totalWaiting : 0 });
        } catch (err) {
            console.log('\n err in getCountForWaitingList:', err.message || err);
            return resolve({ count: 0, totalCount: 0 });
        }
    })
}
const updateMessage = (locationId = null, clinicId = null, patientId = null, content = '', type = 2, isTwilio = false, media = []) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!locationId || !clinicId || !patientId) {
                throw new Error(getErrorMessage('somethingWrong'));
            }
            const payload = {
                content: content,
                patientId: patientId,
                clinicId: clinicId,
                locationId: locationId,
                type: type,
                media,
                twilioSend: isTwilio
            }
            if (type === 2) {
                payload['isReadByAdmin'] = true;
            }
            const response = await DBoperations.saveData(Message, payload);
            if (type === 1) {
                const { start, end } = await getUTCStartEndOfTheDay();
                const patientFortheDay = await DBoperations.findOne(ClinicPatient, {
                    patientId: patientId,
                    locationId: locationId,
                    $or: [{ inQueue: true }, { isCheckIn: true }, { isCheckOut: true }],
                    is_delete: { $ne: true },
                    visitDate: { $gte: new Date(start), $lte: new Date(end) }
                }, {}, { lean: true });
                if (patientFortheDay) {
                    const patientData = await DBoperations.findOne(User, { _id: patientId }, { first_name: 1, last_name: 1, fullNumber: 1 }, { lean: true });
                    let first_name = (patientData && patientData.first_name) ? patientData.first_name : '';
                    let last_name = (patientData && patientData.last_name) ? patientData.last_name : '';
                    let fullNumber = (patientData && patientData.fullNumber) ? patientData.fullNumber : '';
                    let full_name = (first_name) ? `${first_name} ${last_name}` : fullNumber;
                    let message = `${full_name} send ${content} .`;
                    io.sockets.to(`room_${clinicId}`).emit('new-message', { clientId: clinicId, patientId: patientId, message: message, locationId: locationId });
                }
            }
            return resolve(response);
        } catch (err) {
            return reject(err);
        }
    })
}

const initialUpdateMessage = (locationId = null, clinicId = null, patientId = null, content = '', type = 2) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!locationId || !clinicId || !patientId) {
                throw new Error(getErrorMessage('somethingWrong'));
            }
            const payload = {
                content: content,
                patientId: patientId,
                clinicId: clinicId,
                locationId: locationId,
                type: type,
                initial_message: true
            }
            const response = await DBoperations.saveData(Message, payload);
            return resolve(response);
        } catch (err) {
            return reject(err);
        }
    })
}


const sendMail = (toEmail, subject = "", htmlContent = "", istext = false, textContent = "") => {
    return new Promise(async (resolve, reject) => {
        try {
            const msg = {
                to: toEmail,
                from: process.env.SENDGRID_MAIL_FROM, // Use the email address or domain you verified above
                subject: subject,
            };
            if (istext) {
                msg['text'] = textContent;
            } else {
                msg['html'] = htmlContent;
            }
            await sgMail.send(msg);
            return resolve(true);
        } catch (error) {
            return reject(error);
        }
    })
}
const addMinutes = (minutes = 0) => {
    return new Promise(async (resolve, reject) => {
        try {
            var updatedDate = moment.utc().add(minutes, 'minutes').format();
            return resolve({ updatedDate: updatedDate });
        } catch (err) {
            return reject(err);
        }
    })
}
const subtractMinutes = (minutes = 0) => {
    return new Promise(async (resolve, reject) => {
        try {
            var updatedDate = moment.utc().subtract(minutes, 'minutes').format();
            return resolve({ updatedDate: updatedDate });
        } catch (err) {
            return reject(err);
        }
    })
}

const getEnvVariable = (param) => {
    return new Promise((resolve) => {
        if (!process.env[param]) {
            return resolve(null)
        } else {
            return resolve(process.env[param])
        }
    })
}

const getFormQuestions = (formID) => {
    return new Promise(async (resolve, reject) => {
        try {
            const formQuestions = await jotform.getFormQuestions(formID);
            return resolve(formQuestions);
        } catch (err) {
            return reject(err)
        }
    })
}
const createFormSubmission = (formID, submissions) => {
    return new Promise(async (resolve, reject) => {
        try {
            const formSubmissions = await jotform.createFormSubmission(formID, submissions);
            return resolve(formSubmissions);
        } catch (err) {
            console.log('\n createFormSubmission errerrerr:', err)
            return reject(err)
        }
    })
}
const tracer = async (req) => {
    
  try {
    let userDetails = null;
    try {
      userDetails = await verifyToken(req.header('Authorization'));
    } catch (error) {
      
    }
    const ips = (
        req.headers['myip'] ||
        req.ip ||
        req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress || ''
    );
    const ip = ips.split(',')[0].trim();
    const data = {
      userAgent: req.headers['user-agent'],
      user: userDetails?.id,
      url: req.originalUrl,
      ip
    }
    logger.requests(data)
  } catch (error) {
    console.log('tracer', error)
  }
}
const syncFormSubmissions = async () => {
    try {
        const apikey = process.env.JOT_FORM_KEY;

        const patients = await DBoperations.findAll(
            ClinicPatient,
            {
                submissionID: null,
                createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            {},
            { lean: true }
        );
        const locationIds = [...new Set(patients.map(el => el.locationId))];

        // let locationForms = {};

        let formIds = [];

        for (const locationId of locationIds) {
            const formId = await fetchJotformId(locationId)
            // locationForms[locationId] = formId;
            formIds.push(formId)
        }
        // formIds = await Promise.all(formIds);

        let submissions = [];

        for (const formId of formIds) {
            const { data } = await axios.get(`${process.env.JOT_FORM_URL}/form/${formId}/submissions`,
                { params: { apikey } }
            )
            submissions = [...submissions, ...data.content];
        }

        for (const patient of patients) {
            console.log('patient', patient._id);
            for (const submission of submissions) {
                // console.info('submission', submission.id, submission.form_id)
                for (const key in submission.answers) {
                    if (submission.answers[key].name === 'clientPatientId' && submission.answers[key].answer == patient._id) {
                        console.log('patient ans', submission.answers[key].answer, patient._id);
                        try {
                            syncPatient(submission);
                        } catch (err) {
                            console.log(err)
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.log(err)
    }
}

const syncPatient = (payload) => {
    return new Promise(async (resolve, reject) => {
        let clinicPatient = null;
        try {
            const submissionID = payload.id ? payload.id : null;
            const FormId = payload.form_id ? payload.form_id : null;
            // const rowData = JSON.parse(payload.rawRequest);
            let rowData = {};
            for (const key in payload.answers) {
                rowData[`q${key}_${payload.answers[key].name}`] = payload.answers[key].answer;
            }
            //console.log("\n jotNotification rowData:", rowData);
            if (!submissionID || !FormId) {
                return reject({ message: "FormId or submissionID missing." });
            }

            const questions = await commonFunctions.getFormQuestions(FormId);
            if (!questions) {
                return reject({ message: "Jot Form questions missing." });
            }
            const userPayload = {};
            const clinicPayload = {
                uploadNotify: false,
                inQueue: true,
                inQueueAt: new Date(),
                submitPaperWork: true,
                submissionID: submissionID,
            };
            let clientPatientId = null;
            let parentPatientId = null;

            for (let [key, value] of Object.entries(questions)) {
                if (value && value.hasOwnProperty("name")) {
                    let fieldName = value.name;
                    //console.log("\n\n== fieldName :", fieldName)
                    let qid = value.hasOwnProperty("qid") ? value.qid : 0;
                    switch (fieldName) {
                        case "whatParking":
                            clinicPayload["parkingSpot"] = rowData[`q${qid}_whatParking`];
                            break;
                        case "hasPatient":
                            const hasValue = rowData[`q${qid}_hasPatient`];
                            userPayload["hasPatient"] =
                                hasValue && hasValue === "NO" ? 2 : 1;
                            break;
                        case "patientName":
                            userPayload["first_name"] =
                                rowData[`q${qid}_patientName`]["first"];
                            userPayload["last_name"] =
                                rowData[`q${qid}_patientName`]["last"];
                            break;
                        case "dateOfBirth":
                            if (rowData[`q${qid}_dateOfBirth`]) {
                                const year = rowData[`q${qid}_dateOfBirth`]["year"];
                                const month = rowData[`q${qid}_dateOfBirth`]["month"];
                                const day = rowData[`q${qid}_dateOfBirth`]["day"];
                                userPayload["dob"] = new Date(`${year}-${month}-${day}`);
                            }
                            break;
                        case "dateOf":
                            let dateOf = rowData[`q${qid}_dateOf`];
                            if (dateOf) {
                                const [month, day, year] = dateOf.split('/');
                                userPayload["dob"] = new Date(`${year}-${month}-${day}`);
                            }
                            break;
                        case "reasonFor":
                            clinicPayload["visitReason"] = rowData[`q${qid}_reasonFor`];
                            break;
                        case "email":
                            userPayload["email"] = rowData[`q${qid}_email`];
                            break;
                        case "insuranceCardUpdate":
                            let in_field = rowData[`q${qid}_insuranceCardUpdate`];
                            if (in_field && in_field !== "" && in_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "drivingLicenseFront":
                            let df_field = rowData[`q${qid}_drivingLicenseFront`];
                            if (df_field && df_field !== "" && df_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "drivingLicenseBack":
                            let db_field = rowData[`q${qid}_drivingLicenseBack`];
                            if (db_field && db_field !== "" && db_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "insuranceFront":
                            let if_field = rowData[`q${qid}_insuranceFront`];
                            if (if_field && if_field !== "" && if_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "secondaryInsuranceFront":
                            let sif_field = rowData[`q${qid}_secondaryInsuranceFront`];
                            if (sif_field && sif_field !== "" && sif_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "patientSecondaryInsuranceAdd":
                            let ps_field = rowData[`q${qid}_patientSecondaryInsuranceAdd`];
                            if (ps_field && ps_field !== "" && ps_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "secondaryInsuranceBack":
                            let sib_field = rowData[`q${qid}_secondaryInsuranceBack`];
                            if (sib_field && sib_field !== "" && sib_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "initials":
                            let i_field = rowData[`q${qid}_initials`];
                            if (i_field && i_field !== "" && i_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "signature":
                            let s_field = rowData[`q${qid}_signature`];
                            if (s_field && s_field !== "" && s_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "insuranceBack":
                            let ib_field = rowData[`q${qid}_insuranceBack`];
                            if (ib_field && ib_field !== "" && ib_field !== "")
                                clinicPayload["uploadNotify"] = true;
                            break;
                        case "clientPatientId":
                            clientPatientId = rowData[`q${qid}_clientPatientId`];
                            break;
                        case "parentPatientId":
                            parentPatientId = rowData[`q${qid}_parentPatientId`];
                            break;
                        case "gender":
                            switch (rowData[`q${qid}_gender`]) {
                                case "Male":
                                    userPayload.gender = 1;
                                    break;
                                case "Female":
                                    userPayload.gender = 2;
                                    break;
                                case "Other":
                                    userPayload.gender = 3;
                                    break;
                                default:
                                    userPayload.gender = 1;
                                    break;
                            }
                            break;
                        default:
                            break;
                    }
                }
            }
            if (parentPatientId) {
                const parentPatientData = await DBoperations.findOne(
                    ClinicPatient,
                    { _id: parentPatientId },
                    {},
                    { lean: true }
                );
                if (!parentPatientData) {
                    return reject({
                        message: "No parent patient found with parentPatientId.",
                    });
                }
                const subPatientPayload = {
                    first_name: userPayload.first_name ? userPayload.first_name : "",
                    last_name: userPayload.last_name ? userPayload.last_name : "",
                    email: userPayload.email ? userPayload.email : "",
                    gender: userPayload.gender ? userPayload.gender : 1,
                    dob: userPayload.dob ? userPayload.dob : new Date(),
                    parentClientId: parentPatientId,
                    submissionID: submissionID,
                };
                await DBoperations.saveData(SubPatientSchema, subPatientPayload);
                const clinicLocationData = await DBoperations.findOne(
                    locationSchema,
                    { _id: parentPatientData.locationId },
                    { twilioNumber: 1, clinicId: 1, allowSmsFeature: 1 },
                    { lean: true }
                );
                const updatedUser = await DBoperations.findOne(
                    User,
                    { _id: parentPatientData.patientId },
                    {},
                    { lean: true }
                );
                let sendMessage = `${subPatientPayload.first_name} is Successfully added into your queue list`;
                if (clinicLocationData?.allowSmsFeature) {
                    const sendPayload = {
                        to: updatedUser.fullNumber,
                        from: clinicLocationData.twilioNumber,
                        body: sendMessage,
                    };
                    await commonFunctions.sendTwilioMessage(sendPayload);
                    await commonFunctions.updateMessage(
                        clinicLocationData._id,
                        clinicLocationData.clinicId,
                        updatedUser._id,
                        sendMessage,
                        2,
                        true
                    );
                } else {
                    await commonFunctions.updateMessage(
                        clinicLocationData._id,
                        clinicLocationData.clinicId,
                        updatedUser._id,
                        sendMessage,
                        2,
                        false
                    );
                }
                await DBoperations.findAndUpdate(
                    ClinicPatient,
                    {
                        _id: parentPatientId,
                    },
                    {
                        uploadNotify: true,
                    }
                )
            } else {
                if (!clientPatientId)
                    return reject({
                        message: "No clientPatientid Found into jotform response.",
                    });

                const isResubmit = await DBoperations.findOne(
                    ClinicPatient,
                    {
                        _id: clientPatientId,
                        submissionID: { $ne: null },
                    },
                    {},
                    { lean: true }
                );
                if (isResubmit) {
                    const user = await DBoperations.findOne(User, { _id: isResubmit.patientId }, {}, { lean: true });
                    const location = await DBoperations.findOne(locationSchema, { _id: isResubmit.locationId }, {}, { lean: true });
                    const sendPayload = {
                        to: user.fullNumber,
                        from: location.twilioNumber,
                        body: `Your link is expired, please get new link by sending "Arrived" sms.`,
                    };
                    await commonFunctions.sendTwilioMessage(sendPayload);
                    return reject({
                        message: "Resubmission jotform.",
                    });
                }

                const clientPatientData = await DBoperations.findOne(
                    ClinicPatient,
                    { _id: clientPatientId },
                    {},
                    { lean: true }
                );
                if (!clientPatientData) {
                    return reject({ message: "No patient found with submissionId." });
                }
                clinicPatient = clientPatientData;
                await Promise.all([
                    await DBoperations.findAndUpdate(
                        ClinicPatient,
                        {
                            _id: clientPatientData._id,
                            isCheckIn: false,
                            isCheckOut: false,
                        },
                        clinicPayload
                    ),
                    await DBoperations.findAndUpdate(
                        User,
                        { _id: clientPatientData.patientId },
                        userPayload
                    ),
                ]);
                const [
                    updatedUser,
                    clinicSetting,
                    clinicLocationData,
                    uploaded_files,
                ] = await Promise.all([
                    DBoperations.findOne(
                        User,
                        { _id: clientPatientData.patientId },
                        {},
                        { lean: true }
                    ),
                    DBoperations.findOne(
                        settingSchema,
                        { clinicId: clientPatientData.clinicId },
                        {},
                        {}
                    ),
                    DBoperations.findOne(
                        locationSchema,
                        { _id: clientPatientData.locationId },
                        { twilioNumber: 1, clinicId: 1, allowSmsFeature: 1 },
                        { lean: true }
                    ),
                    commonFunctions.getSubmission(submissionID),
                ]);
                const businessName =
                    clinicSetting &&
                        clinicSetting.businessInformation &&
                        clinicSetting.businessInformation.companyName
                        ? clinicSetting.businessInformation.companyName
                        : "Our business";
                const userName = `${updatedUser.first_name} ${updatedUser.last_name}`;
                let sendMessage = await commonFunctions.getReplyMessage(
                    "submit_paperwork",
                    0,
                    0,
                    businessName,
                    userName,
                    0
                );
                if (clinicLocationData?.allowSmsFeature) {
                    const sendPayload = {
                        to: updatedUser.fullNumber,
                        from: clinicLocationData.twilioNumber,
                        body: sendMessage,
                    };
                    // console.log("\n on submit 1st jotform..", sendMessage);
                    await Promise.all([
                        commonFunctions.sendTwilioMessage(sendPayload),
                        commonFunctions.updateMessage(
                            clinicLocationData._id,
                            clinicLocationData.clinicId,
                            updatedUser._id,
                            sendMessage,
                            2,
                            true
                        ),
                    ]);
                } else {
                    await commonFunctions.updateMessage(
                        clinicLocationData._id,
                        clinicLocationData.clinicId,
                        updatedUser._id,
                        sendMessage,
                        2,
                        false
                    );
                }

                io.sockets
                    .to(`room_${clinicLocationData.clinicId}`)
                    .emit("new-patient", {
                        clientId: clinicLocationData.clinicId,
                        locationId: clinicLocationData._id,
                    });
                commonFunctions.updateMessage(
                    clinicLocationData._id,
                    clinicLocationData.clinicId,
                    updatedUser._id,
                    "patient has completed Paperwork.",
                    1
                );
                if (uploaded_files && uploaded_files.length > 0) {
                    await commonFunctions.updateMessage(
                        clinicLocationData._id,
                        clinicLocationData.clinicId,
                        updatedUser._id,
                        "patient uploaded file over jotfrom.",
                        1
                    );
                }
            }
            //const isFieldDataEmpty = await commonFunctions.IsEmpty(userPayload);

            /* if (isFieldDataEmpty) {
                        await DBoperations.findAndUpdate(ClinicPatient, { _id: clientPatientData._id, isCheckIn: false, isCheckOut: false }, clinicPayload);
                    } else { */

            //}
            return resolve(true);
        } catch (error) {
            console.log(error);
            // logger.error({path: 'twillio controller 547', error: error.message || error})
            if (error.name === "MongoError" && error.code === 11000) {
                return reject(
                    new Error(
                        "email must be unique. THis email already exist into our system."
                    )
                );
            } else {
                if (!clinicPatient) {
                    return reject(error);
                }
                const [userData, clinicLocationData] = await Promise.all([
                    DBoperations.findOne(
                        User,
                        { _id: clinicPatient.patientId },
                        {},
                        { lean: true }
                    ),
                    DBoperations.findOne(
                        locationSchema,
                        { _id: clinicPatient.locationId },
                        { twilioNumber: 1, clinicId: 1, allowSmsFeature: 1 },
                        { lean: true }
                    ),
                ]);
                if (!userData) return reject(error);
                const sendMessage = error.message
                    ? `During save jotform info follow error occur: ${error.message} . Please contact to clinic.`
                    : "Something went wrong during submit your basic info.Please try again with same link.";
                if (error.code && error.code === 21610) {
                    await commonFunctions.updateMessage(
                        clinicLocationData._id,
                        clinicLocationData.clinicId,
                        userData._id,
                        sendMessage,
                        2
                    );
                } else {
                    if (clinicLocationData?.allowSmsFeature) {
                        const sendPayload = {
                            to: userData.fullNumber,
                            from: clinicLocationData.twilioNumber,
                            body: sendMessage,
                        };
                        await Promise.all([
                            commonFunctions.sendTwilioMessage(sendPayload),
                            commonFunctions.updateMessage(
                                clinicLocationData._id,
                                clinicLocationData.clinicId,
                                userData._id,
                                sendMessage,
                                2,
                                true
                            ),
                        ]);
                    } else {
                        await commonFunctions.updateMessage(
                            clinicLocationData._id,
                            clinicLocationData.clinicId,
                            userData._id,
                            sendMessage,
                            2,
                            false
                        );
                    }
                }
                return reject(error);
            }
        }
    });
}
const editFormSubmission = (submissionId, submissions) => {
    return new Promise(async (resolve, reject) => {
        try {
            const formSubmissions = await jotform.editSubmission(submissionId, submissions);
            return resolve(formSubmissions);
        } catch (err) {
            console.log('\n createFormSubmission errerrerr:', err)
            return reject(err)
        }
    })
}
const formatDate = (date, formatType) => {
    return new Promise((resolve, reject) => {
        try {
            var updatedDate = moment(date).format(formatType);
            return resolve(updatedDate);
        } catch (err) {
            return reject(err);
        }
    })
}
const IsEmpty = (payload) => {
    return new Promise((resolve) => {
        try {
            if (_.isEmpty(payload)) {
                return resolve(true);
            }
            return resolve(false);
        } catch (err) {
            return resolve(true);
        }
    })
}
const getformatedStartEndDay = (date, offset = 0) => {
    return new Promise(async (resolve, reject) => {
        try {
            var start = moment(new Date(date)).utc().utcOffset(Number(offset), true).startOf('day');
            var end = moment(new Date(date)).utc().utcOffset(Number(offset), true).endOf('day');
            return resolve({ start: start, end: end });
        } catch (err) {
            return reject(err);
        }
    })
}
const fetchJotformId = async (locationId = null, formNumber = 1) => {
    try {
        const populateQuery = [{
            path: 'jotformId',
            select: {
                jotformId: 1,
            }
        }];
        const location = await DBoperations.findOne(locationSchema, { _id: mongoose.Types.ObjectId(locationId) }, {}, {})
            .populate(populateQuery).exec();
        return location?.jotformId?.jotformId || '212075810747152'
    } catch (error) {
        return '212075810747152'
    }
}
const verifyLocationId = async function (userData) {
    return new Promise(async (resolve, reject) => {
        try {
            if (!userData.locationId) {
                throw new Error(commonFunctions.getErrorMessage('missingLocation'));
            }
            const locationData = await DBoperations.findOne(locationSchema, { _id: userData.locationId }, {}, {});
            if (!locationData) {
                throw new Error('No location found.Please check your location Id.');
            } else if (!locationData.twilioNumber) {
                throw new Error('Contact to Admin for assign a unique messaging number to location.');
            }
            return resolve(locationData);
        } catch (err) {
            err.status = 401;
            (err.message && err.message === 'jwt malformed') ? err.message = getErrorMessage("unAuth") : err;
            return reject(err);
        }
    })
}
const getFormData = (submissionID) => {
    return new Promise(async (resolve, reject) => {
        try {
            const formQuestions = await jotform.getSubmission(submissionID);
            return resolve(formQuestions);
        } catch (err) {
            return reject(err)
        }
    })
}
const fetchFormFieldNeedToCheck = () => {
    return new Promise((resolve) => {
        try {
            return resolve(jotformField_needToCheck);
        } catch (err) {
            return resolve([])
        }
    })
}
const getSubmission = (SID) => {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await jotform.getSubmission(SID);
            const uploadArray = [];
            if (response && response.hasOwnProperty('answers')) {
                for (let [key, value] of Object.entries(response.answers)) {
                    if (value && value.hasOwnProperty('name')) {
                        if (value?.type === 'control_fileupload' && value?.answer.length) {
                            uploadArray.push(value?.answer[0]);
                        }
                        //console.log('\n qid:::', qid);
                        // switch (fieldName) {
                        //     case 'insuranceCardUpdate':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'drivingLicenseFront':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'drivingLicenseBack':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'insuranceFront':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'insuranceBack':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'secondaryInsuranceFront':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'secondaryInsuranceBack':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     case 'patientSecondaryInsuranceAdd':
                        //         if (value.answer && value.answer !== 'NO')
                        //             uploadArray.push(value.answer);
                        //         break;
                        //     default:
                        //         break;
                        // }
                    }
                }
            }
            /* case 'signature':
                                if (value.answer && value.answer !== 'NO')
                                    uploadArray.push(value.answer);
                                break;  
            case 'initials':
                                if (value.answer && value.answer !== 'NO')
                                    uploadArray.push(value.answer);
                                break;*/
            return resolve(uploadArray);
        } catch (err) {
            return reject(err)
        }
    })
}
const saveToPdfFile = (html, submissionID) => {
    return new Promise((resolve, reject) => {
        try {
            PDFDocument.create(html).toStream(function (err, stream) {
                if (err) {
                    return reject(err);
                }
                const folder = `pdf/${submissionID}.pdf`;
                const path = `./public/${folder}`;
                stream.pipe(fs.createWriteStream(path));
                return resolve(folder);
            });

        } catch (err) {
            return reject(err);
        }
    })
}
const shorterUrl = async (longUrl) => {
    try {
        if (!process.env.BITLY_URL || !process.env.BITLY_TOKEN) {
            return Promise.resolve({ status: false, message: 'Missing bitly basic configuration', short_response: {} });
        }
        const payload = {
            "domain": "pll.wiki",
            "long_url": longUrl
        }
        const url = process.env.BITLY_URL;
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.BITLY_TOKEN}` },
            data: JSON.stringify(payload),
            url,
        };
        const response = await axios(options);
        if (response && response.data)
            return Promise.resolve({ status: true, message: 'success', short_response: response.data });
        else
            return Promise.resolve({ status: false, message: 'not not found', short_response: {} });

    } catch (err) {
        console.log("\n error here:", err, "\n\n\n\n")
        const message = err && err.message ? err.message : 'Error in shorter url.';
        return Promise.resolve({ status: false, message: message, short_response: {} });
    }
}
function deleteMediaItem(mediaItem) {
    const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    return client
      .api.accounts(process.env.TWILIO_ACCOUNT_SID)
      .messages(mediaItem.MessageSid)
      .media(mediaItem.mediaSid).remove();
}
async function SaveMmsMedia(mediaItem) {
    const { mediaUrl, mediaSid, contentType } = mediaItem;
    const fileName = `${mediaSid}.${mime.getExtension(contentType)}`;
    const fullPath = `public/images/mms/${fileName}`;

    if (!fs.existsSync(fullPath)) {
        const response = await axios({
            method: 'get',
            url: mediaUrl,
            responseType: 'stream',
        });
        const fileStream = fs.createWriteStream(fullPath);

        response.data.pipe(fileStream);

        deleteMediaItem(mediaItem);
    }

    return fileName;
}
const saveSmsMedia = async (dataString) => {
    const matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (matches.length !== 3) {
        return new Error('Invalid input string');
    }
    const dataBuffer = new Buffer.from(matches[2], 'base64');
    const uniqueStr = Date.now().toString(36) + (Math.random() * (9999 - 1000) + 1000).toString(26)
    const fileName = `${uniqueStr}.${mime.getExtension(matches[1])}`;
    try {
        await fs.promises.mkdir("public/images/mms/", { recursive: true });
        await fs.writeFileSync("public/images/mms/" + fileName, dataBuffer, {encoding: 'utf8'});
        return fileName;
    }
    catch (err) {
        console.error(err)
    }
    return '';
}
const getSmsMediaUrl = (fileName) => {
    return `${process.env.API_URL}/images/mms/${fileName}`;
}
const addAdmin = async () => {
    return new Promise(async (resolve) => {
        try {
            const admin_email = "admin@parkinglotlobby.com";
            const admin_password = "Admin@pll";
            var checkEmailExist = await DBoperations.findOne(User, { email: admin_email, userType: 3 }, {}, { lean: true });
            if (!checkEmailExist) {
                const cryptedPassword = await createHash(admin_password);
                const payload = {
                    email: admin_email,
                    password: cryptedPassword,
                    agreeTermCondition: true,
                    first_name: "admin",
                    last_name: "user",
                    userType: 3,
                    gender: 1
                }
                await DBoperations.saveData(User, payload);
            }
            return resolve(true);
        } catch (err) {
            console.log('error in add admin comman function:', err.message || err);
            return resolve(false);
        }
    })
}
const getWeekMonthYearStartEnd = () => {
    return new Promise(async (resolve, reject) => {
        try {
            var weekStart = moment(new Date()).utc().utcOffset('-0500').startOf('week');
            var weekEnd = moment(new Date()).utc().utcOffset('-0500').endOf('week');

            var monthStart = moment(new Date()).utc().utcOffset('-0500').startOf('month');
            var monthEnd = moment(new Date()).utc().utcOffset('-0500').endOf('month');

            var yearStart = moment(new Date()).utc().utcOffset('-0500').startOf('year');
            var yearEnd = moment(new Date()).utc().utcOffset('-0500').endOf('year');

            return resolve({
                weekStart: weekStart, weekEnd: weekEnd,
                monthStart: monthStart, monthEnd: monthEnd,
                yearStart: yearStart, yearEnd: yearEnd
            });
        } catch (err) {
            return reject(err);
        }
    })
}
const commonFunctions = {
    compareHashPassword: compareHashPassword,
    createHash: createHash,
    setToken: setToken,
    verifyToken: verifyToken,
    getReplyMessage: getReplyMessage,
    getErrorMessage: getErrorMessage,
    getUTCStartEndOfTheDay: getUTCStartEndOfTheDay,
    checkUserInformation: checkUserInformation,
    getSuccessMessage: getSuccessMessage,
    sendTwilioMessage: sendTwilioMessage,
    checkSettingAndUpdateMessage: checkSettingAndUpdateMessage,
    getCountForWaitingList: getCountForWaitingList,
    updateMessage: updateMessage,
    initialUpdateMessage: initialUpdateMessage,
    sendMail: sendMail,
    addMinutes: addMinutes,
    getEnvVariable: getEnvVariable,
    getFormQuestions: getFormQuestions,
    createFormSubmission: createFormSubmission,
    editFormSubmission: editFormSubmission,
    formatDate: formatDate,
    IsEmpty: IsEmpty,
    getformatedStartEndDay: getformatedStartEndDay,
    fetchJotformId,
    verifyLocationId,
    getFormData,
    fetchFormFieldNeedToCheck,
    getSubmission,
    saveToPdfFile,
    shorterUrl,
    addAdmin,
    subtractMinutes,
    syncFormSubmissions,
    tracer,
    SaveMmsMedia,
    saveSmsMedia,
    getSmsMediaUrl,
    getWeekMonthYearStartEnd
}


module.exports = commonFunctions;
