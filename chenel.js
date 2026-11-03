const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: ইউজারনেম পরিষ্কার করা
function cleanUsername(input) {
    if (!input) return '';
    let cleaned = input.replace(/@/g, '').trim();
    const match = cleaned.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/);
    if (match && match[1]) {
        return match[1];
    }
    return cleaned.replace(/[^a-zA-Z0-9_]/g, '');
}

// Helper: HTML ফেচ করা (axios দিয়ে)
async function getHtml(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        return response.data;
    } catch (err) {
        return null;
    }
}

// Helper: প্রোফাইল পিকচার ডাউনলোড এবং লোকাল ফোল্ডারে সেভ করা
async function downloadProfilePicture(url, username) {
    if (!url) return 'default.jpg';
    const folder = path.join(__dirname, 'tg-photo');
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    const imgPath = path.join(folder, `${username}.jpg`);
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        const writer = fs.createWriteStream(imgPath);
        response.data.pipe(writer);

        return new Promise((resolve) => {
            writer.on('finish', () => resolve(`tg-photo/${username}.jpg`));
            writer.on('error', () => resolve('default.jpg'));
        });
    } catch (e) {
        return 'default.jpg';
    }
}

// Helper: বয়স বা সময়ের ব্যবধান হিসাব করা
function calculateAge(dateString) {
    const createdDate = new Date(dateString);
    const now = new Date();

    let years = now.getFullYear() - createdDate.getFullYear();
    let months = now.getMonth() - createdDate.getMonth();
    let days = now.getDate() - createdDate.getDate();

    if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
    }
    if (months < 0) {
        years--;
        months += 12;
    }

    return `${years} years, ${months} months, ${days} days`;
}

// Helper: সেরা পোস্টের সময় বের করা
function getBestPostTime(postDates, postViews) {
    if (!postDates.length || !postViews.length) return "Unknown";

    const timeSlots = {};
    postDates.forEach((datetime, index) => {
        // +6 hours যোগ করা (Bangladesh Timezone)
        const dateObj = new Date(new Date(datetime).getTime() + (6 * 60 * 60 * 1000));
        const hour = String(dateObj.getHours()).padStart(2, '0');

        if (!timeSlots[hour]) {
            timeSlots[hour] = 0;
        }
        timeSlots[hour] += postViews[index] || 0;
    });

    const sortedSlots = Object.keys(timeSlots).sort((a, b) => timeSlots[b] - timeSlots[a]);
    if (sortedSlots.length === 0) return "Unknown";

    const bestHour = parseInt(sortedSlots[0], 10);
    return `${bestHour}:00 - ${bestHour + 1}:00 (Bangladesh Time)`;
}

// Main Channel Info Function
async function getChannelInfo(input, domain) {
    const username = cleanUsername(input);
    if (!username) {
        return { error: "Invalid username format." };
    }

    const apiUrl = `https://t.me/s/${username}`;
    const html = await getHtml(apiUrl);

    if (!html || !html.includes('tgme_page')) {
        return { error: "Failed to fetch data from Telegram." };
    }

    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') || "Unknown";
    const profilePictureUrl = $('meta[property="og:image"]').attr('content') || "";
    const bio = $('meta[property="og:description"]').attr('content') || "Unknown";
    const category = $('.tgme_page_extra').text().trim() || "Unknown";

    const localPfp = await downloadProfilePicture(profilePictureUrl, username);
    const pfpUrl = `${domain}/${localPfp}`;

    // সাবস্ক্রাইবার সংখ্যা বের করা
    const pageText = $.text();
    const membersMatch = pageText.match(/(\d+)\s+subscribers/);
    const totalMembers = membersMatch ? parseInt(membersMatch[1], 10) : "Unknown";

    // পোস্টের ডেট, ভিউ এবং লিংক সংগ্রহ করা
    const recentPosts = [];
    $('time.datetime').each((_, el) => {
        const dt = $(el).attr('datetime');
        if (dt) recentPosts.push(dt);
    });

    const viewCounts = [];
    $('.tgme_widget_message_views').each((_, el) => {
        const views = parseInt($(el).text().trim(), 10);
        viewCounts.push(isNaN(views) ? 0 : views);
    });

    const postLinks = [];
    $('.tgme_widget_message_date').each((_, el) => {
        const href = $(el).attr('href');
        if (href) postLinks.push(href);
    });

    if (recentPosts.length === 0) {
        return { error: "No posts found for this channel." };
    }

    const createdDate = recentPosts.reduce((min, p) => p < min ? p : min, recentPosts[0]);
    const channelAge = calculateAge(createdDate);

    const lastPostRaw = new Date(new Date(recentPosts[recentPosts.length - 1]).getTime() + (6 * 60 * 60 * 1000));
    const lastPostDate = lastPostRaw.toISOString().replace('T', ' ').substring(0, 19);

    const totalViews = viewCounts.reduce((a, b) => a + b, 0);
    const totalPosts = recentPosts.length;
    const averageViews = totalPosts > 0 ? parseFloat((totalViews / totalPosts).toFixed(2)) : "Unknown";

    let mostViewedPost = "Unknown";
    let mostViewedPostLink = "Unknown";

    if (viewCounts.length > 0) {
        const maxViews = Math.max(...viewCounts);
        mostViewedPost = maxViews;
        const maxIndex = viewCounts.indexOf(maxViews);
        mostViewedPostLink = postLinks[maxIndex] || "Unknown";
    }

    const bestPostTime = getBestPostTime(recentPosts.slice(-10), viewCounts.slice(-10));

    let activeMembers = "Unknown";
    if (totalMembers !== "Unknown" && averageViews !== "Unknown" && totalMembers > 0) {
        activeMembers = parseFloat(((averageViews / totalMembers) * 100).toFixed(2)) + "%";
    }

    const last5Posts = [];
    const startIndex = Math.max(0, recentPosts.length - 5);
    for (let i = startIndex; i < recentPosts.length; i++) {
        const postDateFormatted = new Date(new Date(recentPosts[i]).getTime() + (6 * 60 * 60 * 1000))
            .toISOString().replace('T', ' ').substring(0, 19);
        last5Posts.push({
            date: postDateFormatted,
            views: viewCounts[i] !== undefined ? viewCounts[i] : "Unknown",
            link: postLinks[i] || "Unknown"
        });
    }

    return {
        channel_info: {
            username: username,
            title: title,
            profile_picture: pfpUrl,
            bio: bio,
            category: category,
            channel_age: channelAge,
            channel_link: `https://t.me/${username}`
        },
        stats: {
            total_members: totalMembers,
            average_views: averageViews,
            active_members: activeMembers,
            most_viewed_post: {
                views: mostViewedPost,
                link: mostViewedPostLink
            },
            total_posts: totalPosts
        },
        activity: {
            last_post_date: lastPostDate,
            best_time_to_post: bestPostTime,
            last_5_posts: last5Posts
        },
        Api_Owner: "@MehediSanix",
        Telegram: "@Cobra_Expire",
        Developer: "@MehediSanix2"
    };
}

// Express API Route
app.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ error: "Username parameter is missing" });
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const domain = `${protocol}://${host}`;

    const result = await getChannelInfo(username, domain);
    return res.json(result);
});

// Vercel-এর জন্য এক্সপোর্ট করা হলো (app.listen বাদ দেওয়া হয়েছে)
module.exports = app;
