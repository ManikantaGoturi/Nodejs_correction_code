const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const app = express()
app.use(express.json())
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')

databasePath = path.join(__dirname, 'twitterClone.db')

let database

intilizeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server Running http://localhost:3000/')
    })
  } catch (e) {
    console.log('DB Error:${e.message}')
    process.exit(1)
  }
}

intilizeDbAndServer()

const getFollowingPeopleIdsOfUser = async username => {
  const getTheFollowingPeopleQuery = `
    SELECT
        following_user_id FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE user.username = '${username}';
    `

  const followingPeople = await database.all(getTheFollowingPeopleQuery)
  const arrayOfIds = followingPeople.map(eachUser => eachUser.following_user_id)
  return arrayOfIds
}

const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
    SELECT 
    *
    FROM
    tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE
    tweet.tweet_id = '${tweetId}' AND follower_user_id='${userId}';`
  const tweet = await database.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Response')
  } else {
    next()
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const userDBDetails = await database.get(getUserQuery)

  if (userDBDetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `INSERT INTO user(username, password, name, gender) VALUES ('${username}','${hashPassword}','${name}','${gender}');`
      await database.run(createUserQuery)

      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const userDbDetails = await database.get(getUserQuery)

  if (userDbDetails !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDbDetails.password,
    )

    if (isPasswordCorrect) {
      const payload = {username, userId: userDbDetails.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')

      response.send({jwtToken})
    } else {
      response.status(400)

      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username)

  const getTweetsQuery = `
    SELECT username, tweet, date_time as dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE
    user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;
    `

  const tweets = await database.all(getTweetsQuery)
  response.send(tweets)
})

app.get('/user/following/', authentication, async (request, response) => {
  const {username, userId} = request
  const getFollowingUserQuery = `
    SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id WHERE follower_user_id = '${userId}';
    `

  const followingPeople = await database.all(getFollowingUserQuery)
  response.send(followingPeople)
})

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request

  const getFollowersQuery = `SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE following_user_id = '${userId}';`

  const followers = await database.all(getFollowersQuery)
  response.send(followers)
})

app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `
    SELECT tweet, (SELECT COUNT() FROM Like WHERE tweet_id= '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id='${tweetId}') AS replies,
    date_time AS dateTime

    FROM tweet

    WHERE tweet.tweet_id = '${tweetId}';`

    const tweet = await database.get(getTweetQuery)
    response.send(tweet)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `
    SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = '${tweetId}';
    `
    const likedUsers = await database.all(getLikesQuery)
    const userArray = likedUsers.map(eachUser => eachUser.username)
    response.send({likes: userArray})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getRepliedQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = '${tweetId}';`
    const getUserReplies = await database.all(getRepliedQuery)
    response.send({replies: getUserReplies})
  },
)

app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request

  const getTweetQuery = `
  SELECT tweet,
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,

  date_time AS dateTime

  FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = ${userId}

  GROUP BY tweet.tweet_id;
  `
  const tweets = await database.all(getTweetQuery)
  response.send(tweets)
})

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time) VALUES('${tweet}', '${userId}', '${dateTime}')`
  await database.run(createTweetQuery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId', authentication, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = "${userId}" AND tweet_id = '${tweetId}';`
  const tweet = await database.get(getTheTweetQuery)
  console.log(tweet)
  if (tweet === undefined) {
    response.status(400)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`
    await database.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
